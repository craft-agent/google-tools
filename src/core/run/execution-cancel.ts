import { defineTool, type ToolContext } from "../tool"
import { changed, operationReport, sendChange } from "./change"
import {
  runExecutionCancelInput,
  runExecutionCancelOutput,
  type RunExecutionCancelArgs,
  type RunExecutionCancelResult,
} from "./execution-cancel-args"
import { describeExecutionCancel } from "./execution-cancel-describe"
import { planExecutionCancel } from "./execution-cancel-plan"
import { executionReply, executionView } from "./execution-view"
import type { WaitOptions } from "./operation-wait"
import { RUN_TOOLSET } from "./scopes"
import { executionTargets } from "./target"

/** Cancels the execution and waits for the operation; `wait` is for tests. */
export async function cancelExecution(
  args: RunExecutionCancelArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunExecutionCancelResult> {
  const plan = await planExecutionCancel(args, ctx)
  const outcome = await sendChange(plan, plan.request, ctx.signal, wait)
  return {
    execution: changed(outcome, executionReply, executionView),
    operation: operationReport(outcome),
  }
}

export const googleRunExecutionCancel = defineTool({
  id: "google_run_execution_cancel",
  title: "Cancel Cloud Run execution",
  intent: "About to cancel a Cloud Run execution",
  description:
    "Cancel a running Cloud Run execution of a job, named by `project`, `region`, `job` and `execution` (short names, as `google_run_read` method `executions` lists them). " +
    "This stops the run part way: tasks that are running are stopped and tasks that have not started do not start, so it overwrites what the run would have done. An execution that has already finished is refused, and nothing is changed. " +
    "The cancel is sent with the etag it read, so an execution that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns the `execution` as it is once the cancel is done (null while the operation is still running) and the `operation`; with `done: false` it is still running, so follow it with `google_run_read` method `operation` or `execution` before trying again. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "overwrite",
  input: runExecutionCancelInput,
  output: runExecutionCancelOutput,
  targets: (args, ctx) => executionTargets(args, ctx),
  async describe(args, ctx) {
    return describeExecutionCancel(await planExecutionCancel(args, ctx))
  },
  execute: (args, ctx) => cancelExecution(args, ctx),
})
