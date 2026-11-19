import type { ToolContext } from "../tool"
import { staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import { chosenIndex, secretRefusal, type Json } from "./container-change"
import type { ContainerView } from "./container-view"
import type { RunJobRunArgs } from "./job-run-args"
import { readJobState } from "./job-state"
import type { JobView } from "./job-view"
import { RUN_ROUTES } from "./routes"
import { checkedJob } from "./target"
import { timeoutText } from "./timeout"
import { runWriteSession } from "./write-session"

/** What a run says when the job changed since it was read. */
const STALE_MESSAGE = staleMessage("job", "run")

/** A job run planned: what is sent and the job as it was. */
export type JobRunPlan = ChangeSession & {
  label: string
  job: string
  args: RunJobRunArgs
  request: ChangeRequest
  /** The job as it was read, with no environment value. */
  before: JobView
  /** The job's etag, which the write sends; `null` when there is none. */
  etag: string | null
  /** The container the overrides name (the job's only one when it names none), as it was read; `null` when the job has several and the call names none, or has none. */
  container: ContainerView | null
  /** The overrides the call gives, as Google writes them; `undefined` when it gives none. */
  overrides: Json | undefined
}

/** Whether the call overrides the environment or the arguments of a container. */
const overridesContainer = ({ env, args }: RunJobRunArgs) => Object.keys(env ?? {}).length > 0 || args !== undefined

/**
 * The container the call names, `invalid_argument` when it names none of the
 * job's or leaves it out where several could be meant. A call that overrides
 * no container and names none leaves a job of several containers without one.
 */
function chosenContainer(job: JobView, args: RunJobRunArgs): ContainerView | null {
  const { containers } = job.template
  if (args.container === undefined && !overridesContainer(args)) {
    return containers.length === 1 ? (containers[0] ?? null) : null
  }
  const index = chosenIndex(
    containers.map(({ name }) => name ?? ""),
    args.container,
    "job",
  )
  return containers[index] ?? null
}

/** Refuses an override of a variable the container takes from a secret. */
function checkEnv(container: ContainerView | null, env: RunJobRunArgs["env"]): void {
  for (const name of Object.keys(env ?? {})) {
    if (container?.env.some((entry) => entry.name === name && entry.kind === "secret")) throw secretRefusal(name)
  }
}

/** The override of the chosen container: its name when it has one, the variables to set, and the arguments or that they are cleared. */
function containerOverride(container: ContainerView | null, { env, args }: RunJobRunArgs): Json {
  const override: Json = {}
  if (container !== null && container.name !== null) override.name = container.name
  const entries = Object.entries(env ?? {})
  if (entries.length > 0) override.env = entries.map(([name, value]) => ({ name, value }))
  if (args !== undefined) {
    if (args.length === 0) override.clearArgs = true
    else override.args = args
  }
  return override
}

/** The overrides of Google's `RunJobRequest` the call gives, or `undefined` when it gives none. */
function overridesOf(container: ContainerView | null, args: RunJobRunArgs): Json | undefined {
  const overrides: Json = {}
  if (overridesContainer(args)) overrides.containerOverrides = [containerOverride(container, args)]
  if (args.task_count !== undefined) overrides.taskCount = args.task_count
  if (args.timeout_seconds !== undefined) overrides.timeout = timeoutText(args.timeout_seconds)
  return Object.keys(overrides).length === 0 ? undefined : overrides
}

/**
 * Checks the ids and the label's scopes before anything is read, then reads
 * the job, which must exist, and plans the run: the overrides the call gives,
 * sent with the etag read. An override of a variable that references a secret
 * is refused.
 */
export async function planJobRun(args: RunJobRunArgs, ctx: ToolContext): Promise<JobRunPlan> {
  const { place, job } = checkedJob(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.jobRun)
  const state = await readJobState(client, place, job)
  const container = chosenContainer(state.view, args)
  checkEnv(container, args.env)
  const overrides = overridesOf(container, args)
  const request: ChangeRequest = {
    route: RUN_ROUTES.jobRun,
    params: { ...place, job },
    body: { ...(state.etag !== null && { etag: state.etag }), ...(overrides !== undefined && { overrides }) },
    stale: STALE_MESSAGE,
  }
  return {
    client,
    runtime,
    place,
    label,
    job,
    args,
    request,
    before: state.view,
    etag: state.etag,
    container,
    overrides,
  }
}
