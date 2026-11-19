import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { fixture as sheetsFixture } from "../sheets/read.testing"
import { invoke } from "../tool"
import { googleRunRead } from "./read"
import { RUN_READ_SCOPE } from "./scopes"

/** Fixtures the Cloud Run read tests share: the state directory and fake Google of the Sheets fixtures, with a label logged in for Cloud Run and the Cloud Run read as the tool. */

export { answer, callOf, cleanUp, freshTokens } from "../sheets/read.testing"

/** What a label logged in for the run toolset, read only, holds. */
export const RUN_CREDENTIAL: Credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, RUN_READ_SCOPE] }

/** The made-up project and region every call names. */
export const PLACE = { project: "my-proj", region: "asia-northeast1" }

/** The path of the region as Google writes a resource name. */
export const PARENT = "projects/my-proj/locations/asia-northeast1"

export const BASE_URL = `https://run.googleapis.com/v2/${PARENT}`
export const SERVICES_URL = `${BASE_URL}/services`
export const JOBS_URL = `${BASE_URL}/jobs`

/** A made-up value for an environment variable, which no result may hold. */
export const SECRET_VALUE = "hunter2-made-up-token-value"

/** A made-up annotation value, which no result may hold. */
export const ANNOTATION_VALUE = "annotation-made-up-value"

/** A GET handler for `url` that answers with `reply` and sees the request. */
export const respond = (url: string, reply: FakeHandler["reply"]): FakeHandler => ({ method: "GET", url, reply })

/** What Cloud Run answers with for a refused call: an error body in Google's shape. */
export const refusal = (status: number, code: string, message = "Refused."): FakeReply => ({
  status,
  json: { error: { code: status, message, status: code } },
})

/** A condition as Google gives it. */
export const condition = (type: string, state: string, extra: Record<string, unknown> = {}) => ({
  type,
  state,
  lastTransitionTime: "2026-05-30T08:00:00.000Z",
  ...extra,
})

/** A container with a plain environment variable, one that references a secret, and an annotation-free shape. */
export const container = (extra: Record<string, unknown> = {}) => ({
  name: "app",
  image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1",
  command: ["node"],
  args: ["server.js"],
  ports: [{ name: "http1", containerPort: 8080 }],
  resources: { limits: { cpu: "1000m", memory: "512Mi" }, cpuIdle: true, startupCpuBoost: false },
  env: [
    { name: "PLAIN", value: SECRET_VALUE },
    { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
  ],
  volumeMounts: [{ name: "certs", mountPath: "/certs" }],
  ...extra,
})

/** The volumes a template holds: one of each kind the view tells apart, with detail that no result may hold. */
export const volumes = () => [
  { name: "certs", secret: { secret: "tls-cert", items: [{ path: "k", version: "1" }] } },
  { name: "db", cloudSqlInstance: { instances: ["my-proj:asia-northeast1:db"] } },
  { name: "blob", gcs: { bucket: "made-up-bucket" } },
  { name: "scratch", emptyDir: {} },
]

/** The settings a revision template, revision and task template share. */
export const templateSettings = (extra: Record<string, unknown> = {}) => ({
  serviceAccount: "runner@my-proj.iam.gserviceaccount.com",
  timeout: "300s",
  executionEnvironment: "EXECUTION_ENVIRONMENT_GEN2",
  vpcAccess: { connector: `${PARENT}/connectors/vpc`, egress: "ALL_TRAFFIC" },
  volumes: volumes(),
  containers: [container()],
  ...extra,
})

/** The fixtures with a label logged in for Cloud Run, and `read` calling the Cloud Run read for `PLACE`. */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = RUN_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const h = await sheetsFixture(handlers, credential, env)
  return { ...h, read: (args: unknown) => invoke(googleRunRead, { ...PLACE, ...(args as object) }, h.ctx) }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>
