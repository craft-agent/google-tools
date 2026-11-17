import { defineTool, type ToolContext } from "../tool"
import { operationReport, startChange } from "./change"
import { MAX_COMMAND_ITEMS, MAX_ENV_ENTRIES } from "./container-args"
import { executionReply, executionView, type ExecutionView } from "./execution-view"
import { describeJobRun } from "./job-run-describe"
import { runJobRunInput, runJobRunOutput, type RunJobRunArgs, type RunJobRunResult } from "./job-run-args"
import { planJobRun } from "./job-run-plan"
import { shortName } from "./names"
import { outcomeOf, startedOperation, type OperationOutcome } from "./operation-wait"
import { RUN_ROUTES } from "./routes"
import { RUN_TOOLSET } from "./scopes"
import { jobTargets } from "./target"

/** The execution an operation's `metadata` or `response` holds, as the view gives it; `null` when it is not one, so a reply of another shape reads as none. */
function executionOf(value: unknown): ExecutionView | null {
  const parsed = executionReply.safeParse(value)
  return parsed.success && shortName(parsed.data.name) !== "" ? executionView(parsed.data) : null
}

/**
 * Starts an execution of the job and returns at once, without waiting for it:
 * the operation lasts as long as the execution. The execution is the
 * operation's response when that is done, else its `metadata`.
 */
export async function runJob(args: RunJobRunArgs, ctx: ToolContext): Promise<RunJobRunResult> {
  const plan = await planJobRun(args, ctx)
  const { operation, reply } = startedOperation(await startChange(plan.client, plan.request))
  const outcome: OperationOutcome = reply.done === true ? outcomeOf(operation, reply) : { operation, done: false }
  const execution = (outcome.done ? executionOf(outcome.response) : null) ?? executionOf(reply.metadata)
  return { execution, operation: operationReport(outcome) }
}

export const googleRunJobRun = defineTool({
  id: "google_run_job_run",
  title: "Run Cloud Run job",
  intent: "About to run a Cloud Run job",
  description:
    "Start a new execution of a Cloud Run job, named by `project`, `region` and `job` (short names, as `google_run_read` lists them). Every call starts another execution, so calling it again runs the job again. " +
    "Optional overrides apply to this execution only and the job is not changed: " +
    `\`env\` (plain variables to set, at most ${MAX_ENV_ENTRIES}; a variable that references a secret is refused), \`args\` (up to ${MAX_COMMAND_ITEMS} items replacing the container's; \`[]\` clears them), \`task_count\` and \`timeout_seconds\` (per task). ` +
    "`container` names the container whose `env` or `args` are overridden; it is needed when the job has several. " +
    "The run is sent with the etag it read, so a job that changed meanwhile fails as `stale`; read it again and retry. " +
    "It does not wait for the execution: the operation lasts as long as the run. Returns at once the `execution` Google started (null when the reply held none) and the `operation`; follow the run with `google_run_read` method `execution`, and its tasks with method `tasks`. " +
    "No environment value is ever returned: variables are given by name and kind. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "add",
  input: runJobRunInput,
  output: runJobRunOutput,
  targets: (args, ctx) => jobTargets(args, ctx, RUN_ROUTES.jobRun),
  async describe(args, ctx) {
    return describeJobRun(await planJobRun(args, ctx))
  },
  execute: (args, ctx) => runJob(args, ctx),
})
