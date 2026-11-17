import type { CallDescription, CallFact } from "../tool"
import { envPin } from "./container-describe"
import { phrase } from "./facts"
import type { JobRunPlan } from "./job-run-plan"
import { etagPin } from "./pins"
import { timeoutText } from "./timeout"
import { RUN_WORDS } from "./words"

/** The `Tasks` fact: the tasks this run starts, marked when the call overrides the job's count; none when neither the call nor the job gives one. */
function tasksFacts({ args, before }: JobRunPlan): CallFact[] {
  if (args.task_count !== undefined) {
    return [{ label: RUN_WORDS.tasks, value: { text: RUN_WORDS.tasksThisRun, values: { count: args.task_count } } }]
  }
  return before.task_count === null ? [] : [{ label: RUN_WORDS.tasks, value: String(before.task_count) }]
}

/** The `Last run` fact: the job's latest execution and whether it finished; none when the job has none. */
function lastRunFacts({ before }: JobRunPlan): CallFact[] {
  const latest = before.latest_execution
  if (latest === null) return []
  const text = latest.completion_time === null ? RUN_WORDS.lastRunRunning : RUN_WORDS.lastRunFinished
  return [{ label: RUN_WORDS.lastRun, value: { text, values: { execution: latest.execution } } }]
}

function facts(plan: JobRunPlan): CallFact[] {
  const { container, before } = plan
  return [
    ...(container === null ? [] : [{ label: RUN_WORDS.image, value: container.image }]),
    ...tasksFacts(plan),
    { label: RUN_WORDS.runsAs, value: before.template.service_account ?? phrase(RUN_WORDS.defaultAccount) },
    ...lastRunFacts(plan),
  ]
}

/** The lines of the overrides the call gives, one per setting: each variable (named, never its value), the arguments, the task count and the timeout. */
function overrideLines({ args }: JobRunPlan): string[] {
  const argsLine = args.args?.length === 0 ? "args: cleared" : `args: ${JSON.stringify(args.args)}`
  return [
    ...Object.keys(args.env ?? {}).map((name) => `env ${name}: set`),
    ...(args.args === undefined ? [] : [argsLine]),
    ...(args.task_count === undefined ? [] : [`tasks: ${args.task_count}`]),
    ...(args.timeout_seconds === undefined ? [] : [`timeout: ${timeoutText(args.timeout_seconds)}`]),
  ]
}

/**
 * What the prompt shows of a job run: the headline, the image and the tasks it
 * runs, the identity it runs as and the job's last run, and the overrides as
 * lines (when the call gives any), with no variable's value. The job's etag and
 * a digest of the chosen container's variables' names and kinds are pins.
 */
export function describeJobRun(plan: JobRunPlan): CallDescription {
  const lines = overrideLines(plan)
  return {
    headline: { text: RUN_WORDS.jobRun, values: { job: plan.job } },
    facts: facts(plan),
    ...(lines.length > 0 && { text: { label: RUN_WORDS.overrides, body: lines.join("\n") } }),
    pins: { ...etagPin(plan.etag), ...envPin(plan.container) },
  }
}
