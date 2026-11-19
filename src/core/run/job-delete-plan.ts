import type { ToolContext } from "../tool"
import { deleteRequest, staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import type { RunJobDeleteArgs } from "./job-delete-args"
import { readJobState } from "./job-state"
import type { JobView } from "./job-view"
import { RUN_ROUTES } from "./routes"
import { checkedJob } from "./target"
import { runWriteSession } from "./write-session"

/** What a deletion says when the job changed since it was read. */
const STALE_MESSAGE = staleMessage("job", "deleted")

/** A job deletion planned: what is sent and the job as it was. */
export type JobDeletePlan = ChangeSession & {
  label: string
  job: string
  request: ChangeRequest
  /** The job as it was read. */
  before: JobView
  /** The job's etag, which the write sends; `null` when there is none. */
  etag: string | null
}

/**
 * Checks the ids and the label's scopes before anything is read, then reads
 * the job, which must exist, and plans the deletion, sent with the etag read.
 */
export async function planJobDelete(args: RunJobDeleteArgs, ctx: ToolContext): Promise<JobDeletePlan> {
  const { place, job } = checkedJob(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.jobDelete)
  const state = await readJobState(client, place, job)
  return {
    client,
    runtime,
    place,
    label,
    job,
    request: deleteRequest(RUN_ROUTES.jobDelete, { ...place, job }, state.etag, STALE_MESSAGE),
    before: state.view,
    etag: state.etag,
  }
}
