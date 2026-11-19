import { NOW } from "../account/read.testing"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolSpec } from "../tool"
import { runDeployInput } from "./deploy-args"
import { deployService, googleRunServiceDeploy } from "./deploy"
import { cancelExecution, googleRunExecutionCancel } from "./execution-cancel"
import { runExecutionCancelInput } from "./execution-cancel-args"
import { deployJob, googleRunJobDeploy } from "./job-deploy"
import { runJobDeployInput } from "./job-deploy-args"
import { deleteJob, googleRunJobDelete } from "./job-delete"
import { runJobDeleteInput } from "./job-delete-args"
import { googleRunJobRun } from "./job-run"
import type { WaitOptions } from "./operation-wait"
import {
  BASE_URL,
  PARENT,
  PLACE,
  RUN_CREDENTIAL,
  SERVICES_URL,
  condition,
  fixture,
  respond,
  templateSettings,
} from "./read.testing"
import { deleteRevision, googleRunRevisionDelete } from "./revision-delete"
import { runRevisionDeleteInput } from "./revision-delete-args"
import { RUN_SCOPE } from "./scopes"
import { deleteService, googleRunServiceDelete } from "./service-delete"
import { runServiceDeleteInput } from "./service-delete-args"
import { LATEST_ALLOCATION, REVISION_ALLOCATION } from "./service-view"
import { runTrafficInput } from "./traffic-args"
import { googleRunTrafficSet, setTraffic } from "./traffic"

/** Fixtures the Cloud Run write tests share: the read fixtures with a label that may read and write, a clock a test moves, a service and its operations as Google gives them, and the write tools bound to them (the job fixtures are in `jobs.testing.ts`). */

export {
  ANNOTATION_VALUE,
  PARENT,
  PLACE,
  SECRET_VALUE,
  SERVICES_URL,
  answer,
  callOf,
  cleanUp,
  condition,
  container,
  freshTokens,
  refusal,
  templateSettings,
  volumes,
} from "./read.testing"

/** What a label logged in for the run toolset, read and write, holds. */
export const WRITE_CREDENTIAL: Credential = { ...RUN_CREDENTIAL, scopes: [...RUN_CREDENTIAL.scopes, RUN_SCOPE] }

/** An image of the project's own registry, which the deploys deploy unless a test says otherwise. */
export const OWN_IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/apps/api:v2"

/** The made-up service the tests change, its URL and the id of the operation its writes start. */
export const SERVICE = "api"
export const SERVICE_URL = `${SERVICES_URL}/${SERVICE}`
export const OPERATION_ID = "op-1"

/** The made-up job and execution the job tests change. */
export const JOB = "nightly"
export const EXECUTION = "nightly-abc12"

/** The made-up revision of the service that the deletion tests delete: one no traffic reaches. */
export const REVISION = "api-00005-old"

/** The URL of an operation, and its name as Google writes it. */
export const operationUrl = (id: string = OPERATION_ID) => `${BASE_URL}/operations/${id}`
const operationName = (id: string) => `${PARENT}/operations/${id}`

/** The traffic of a service that follows its latest revision. */
export const followsLatest = () => ({
  traffic: [{ type: LATEST_ALLOCATION, percent: 100 }],
  trafficStatuses: [{ type: LATEST_ALLOCATION, revision: "api-00007-abc", percent: 100 }],
})

/** The traffic of a service split between two revisions, one of them tagged. */
export const splitTraffic = () => ({
  traffic: [
    { type: REVISION_ALLOCATION, revision: "api-00007-abc", percent: 90 },
    { type: REVISION_ALLOCATION, revision: "api-00006-xyz", percent: 10, tag: "canary" },
  ],
  trafficStatuses: [
    { type: REVISION_ALLOCATION, revision: "api-00007-abc", percent: 90 },
    { type: REVISION_ALLOCATION, revision: "api-00006-xyz", percent: 10, tag: "canary" },
  ],
})

/** A service as `services.get` gives it, with a template that holds fields the tools do not know. */
export const apiService = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/services/${SERVICE}`,
  etag: '"etag-1"',
  generation: "7",
  ingress: "INGRESS_TRAFFIC_ALL",
  terminalCondition: condition("Ready", "CONDITION_SUCCEEDED"),
  latestReadyRevision: `${PARENT}/services/${SERVICE}/revisions/api-00007-abc`,
  latestCreatedRevision: `${PARENT}/services/${SERVICE}/revisions/api-00007-abc`,
  ...followsLatest(),
  template: templateSettings({
    revision: "api-00008-def",
    sessionAffinity: true,
    scaling: { minInstanceCount: 0, maxInstanceCount: 10, futureScalingKey: "kept" },
    maxInstanceRequestConcurrency: 80,
    futureField: { nested: [1, 2, 3] },
  }),
  ...extra,
})

/** An operation as a write and `operations.get` give it. */
export const operation = (extra: Record<string, unknown> = {}) => ({ name: operationName(OPERATION_ID), ...extra })

/** The `@type` prefix of the Cloud Run messages an operation holds. */
export const TYPE_URL = "type.googleapis.com/google.cloud.run.v2"

/** An operation that is done, with the service it changed as its response. */
export const finished = (service: Record<string, unknown> = apiService()) =>
  operation({ done: true, response: { "@type": `${TYPE_URL}.Service`, ...service } })

/** `GET` of the service, answering `reply`. */
export const serviceHandler = (reply: FakeReply = { json: apiService() }): FakeHandler => respond(SERVICE_URL, reply)

/** `PATCH` of the service, answering `reply`. */
export const patchHandler = (reply: FakeHandler["reply"] = { json: finished() }): FakeHandler => ({
  method: "PATCH",
  url: SERVICE_URL,
  reply,
})

/** `POST` that creates a service, answering `reply`. */
export const createHandler = (reply: FakeReply = { json: finished() }): FakeHandler => ({
  method: "POST",
  url: SERVICES_URL,
  reply,
})

/** `GET` of the operation, answering `reply`. */
export const operationHandler = (reply: FakeHandler["reply"]): FakeHandler => respond(operationUrl(), reply)

/** A clock a test moves: it stands still until `advance` moves it. */
export function fakeClock(start: number = NOW) {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

/** A tool bound to a fixture's context: its call, its prompt, its targets, its measure and its gate. */
function bound(spec: ToolSpec, ctx: ToolContext, defaults: Record<string, unknown>) {
  const withDefaults = (args: unknown) => ({ ...defaults, ...(args as object) })
  return {
    run: (args: unknown = {}) => invoke(spec, withDefaults(args), ctx),
    describe: async (args: unknown = {}) => spec.describe!(spec.input.parse(withDefaults(args)), ctx),
    targets: (args: unknown = {}) => writeTargets(spec, withDefaults(args), ctx),
    measure: async (args: unknown = {}) => spec.measure!(spec.input.parse(withDefaults(args)), ctx),
  }
}

/**
 * The Cloud Run fixtures with `credential` (a label that may read and write
 * unless given, `null` for none), `handlers`, a clock a test moves and the
 * write tools bound to them for `PLACE`, the service `api`, the job `nightly`
 * and its execution.
 */
export async function writeFixture(options: { handlers?: FakeHandler[]; credential?: Credential | null } = {}) {
  const h = await fixture(
    options.handlers ?? [],
    options.credential === undefined ? WRITE_CREDENTIAL : options.credential,
  )
  const clock = fakeClock()
  const ctx: ToolContext = { ...h.ctx, runtime: { ...h.ctx.runtime!, now: clock.now } }
  const place = { ...PLACE, service: SERVICE }
  return {
    ...h,
    ctx,
    clock,
    deploy: {
      ...bound(googleRunServiceDeploy, ctx, { ...place, image: OWN_IMAGE }),
      /** The deploy with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        deployService(runDeployInput.parse({ ...place, image: OWN_IMAGE, ...(args as object) }), ctx, wait),
    },
    traffic: {
      ...bound(googleRunTrafficSet, ctx, place),
      /** The traffic change with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        setTraffic(runTrafficInput.parse({ ...place, ...(args as object) }), ctx, wait),
    },
    jobDeploy: {
      ...bound(googleRunJobDeploy, ctx, { ...PLACE, job: JOB, image: OWN_IMAGE }),
      /** The job deploy with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        deployJob(runJobDeployInput.parse({ ...PLACE, job: JOB, image: OWN_IMAGE, ...(args as object) }), ctx, wait),
    },
    jobRun: bound(googleRunJobRun, ctx, { ...PLACE, job: JOB }),
    cancel: {
      ...bound(googleRunExecutionCancel, ctx, { ...PLACE, job: JOB, execution: EXECUTION }),
      /** The cancel with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        cancelExecution(
          runExecutionCancelInput.parse({ ...PLACE, job: JOB, execution: EXECUTION, ...(args as object) }),
          ctx,
          wait,
        ),
    },
    revisionDelete: {
      ...bound(googleRunRevisionDelete, ctx, { ...place, revision: REVISION }),
      /** The revision deletion with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        deleteRevision(runRevisionDeleteInput.parse({ ...place, revision: REVISION, ...(args as object) }), ctx, wait),
    },
    serviceDelete: {
      ...bound(googleRunServiceDelete, ctx, place),
      /** The service deletion with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        deleteService(runServiceDeleteInput.parse({ ...place, ...(args as object) }), ctx, wait),
    },
    jobDelete: {
      ...bound(googleRunJobDelete, ctx, { ...PLACE, job: JOB }),
      /** The job deletion with its wait made short, as no argument can. */
      waiting: (args: unknown, wait: WaitOptions) =>
        deleteJob(runJobDeleteInput.parse({ ...PLACE, job: JOB, ...(args as object) }), ctx, wait),
    },
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
  }
}

export type WriteFixture = Awaited<ReturnType<typeof writeFixture>>
