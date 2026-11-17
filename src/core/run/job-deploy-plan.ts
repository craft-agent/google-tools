import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import type { ContainerView } from "./container-view"
import { imageRepository } from "./image"
import type { RunJobDeployArgs } from "./job-deploy-args"
import { newJob, updatedJob } from "./job-deploy-template"
import { readJobState } from "./job-state"
import type { JobView } from "./job-view"
import { readIfFound } from "./resource-state"
import { RUN_ROUTES } from "./routes"
import { checkedJob } from "./target"
import { runWriteSession } from "./write-session"

/** What a job's deploy says when it lost a race. */
const STALE_MESSAGE = staleMessage("job", "changed")

/** A job deploy planned: what is sent and what the job was before. */
export type JobDeployPlan = ChangeSession & {
  label: string
  job: string
  args: RunJobDeployArgs
  /** `create` when the job did not exist, else `update`. */
  mode: "create" | "update"
  request: ChangeRequest
  /** The job as it was read, with no environment value; `null` when it did not exist. */
  before: JobView | null
  /** The job's etag, which the write sends; `null` when there is none. */
  etag: string | null
  /** The container the call changes, as it was read; `null` when the job did not exist. */
  container: ContainerView | null
}

/** Refuses a parallelism above the task count when a call gives both. */
function checkParallelism({ task_count, parallelism }: RunJobDeployArgs): void {
  if (task_count !== undefined && parallelism !== undefined && parallelism > task_count) {
    throw new ToolError(
      "invalid_argument",
      `\`parallelism\` (${parallelism}) is above \`task_count\` (${task_count}); nothing was changed.`,
    )
  }
}

/**
 * Checks the arguments (the ids, the image against the project's own
 * registry, the parallelism) and the label's scopes before anything is read,
 * then reads the job: one that does not exist is created from the call, one
 * that does is updated by sending Google's whole job back with the changes.
 */
export async function planJobDeploy(args: RunJobDeployArgs, ctx: ToolContext): Promise<JobDeployPlan> {
  const { place, job } = checkedJob(args)
  imageRepository(args.image, place.project)
  checkParallelism(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.jobPatch)
  const base = { client, runtime, place, label, job, args }
  const state = await readIfFound(() => readJobState(client, place, job))

  if (state === undefined) {
    const request: ChangeRequest = {
      route: RUN_ROUTES.jobCreate,
      params: place,
      query: { jobId: job },
      body: newJob(args),
      stale: STALE_MESSAGE,
    }
    return { ...base, mode: "create", request, before: null, etag: null, container: null }
  }

  const { job: body, index } = updatedJob(state.raw, args)
  const request: ChangeRequest = {
    route: RUN_ROUTES.jobPatch,
    params: { ...place, job },
    body,
    stale: STALE_MESSAGE,
  }
  const container = state.view.template.containers[index] ?? null
  return { ...base, mode: "update", request, before: state.view, etag: state.etag, container }
}
