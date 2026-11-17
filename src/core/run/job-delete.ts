import { defineTool, type ToolContext } from "../tool"
import { operationReport, sendChange } from "./change"
import {
  runJobDeleteInput,
  runJobDeleteOutput,
  type RunJobDeleteArgs,
  type RunJobDeleteResult,
} from "./job-delete-args"
import { describeJobDelete } from "./job-delete-describe"
import { planJobDelete } from "./job-delete-plan"
import type { WaitOptions } from "./operation-wait"
import { RUN_ROUTES } from "./routes"
import { RUN_TOOLSET } from "./scopes"
import { jobTargets } from "./target"

/** Deletes the job and waits for the operation; `wait` is for tests. */
export async function deleteJob(
  args: RunJobDeleteArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunJobDeleteResult> {
  const plan = await planJobDelete(args, ctx)
  const outcome = await sendChange(plan, plan.request, ctx.signal, wait)
  return { job: plan.job, deleted: outcome.done, operation: operationReport(outcome) }
}

export const googleRunJobDelete = defineTool({
  id: "google_run_job_delete",
  title: "Delete Cloud Run job",
  intent: "About to delete a Cloud Run job",
  description:
    "Delete a Cloud Run job with its executions, named by `project`, `region` and `job` (short names, as `google_run_read` lists them). " +
    "The record of what the job ran goes with it, and the deletion cannot be undone. " +
    "The deletion is sent with the etag it read, so a job that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns the `job`, `deleted` and the `operation`; `deleted: false` means Google is still deleting, so follow it with `google_run_read` method `operation`. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "administrative",
  input: runJobDeleteInput,
  output: runJobDeleteOutput,
  targets: (args, ctx) => jobTargets(args, ctx, RUN_ROUTES.jobDelete),
  async describe(args, ctx) {
    return describeJobDelete(await planJobDelete(args, ctx))
  },
  execute: (args, ctx) => deleteJob(args, ctx),
})
