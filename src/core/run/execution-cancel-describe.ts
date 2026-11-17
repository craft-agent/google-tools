import type { CallDescription, CallFact } from "../tool"
import { phrase } from "./facts"
import type { ExecutionCancelPlan } from "./execution-cancel-plan"
import { etagPin } from "./pins"
import { RUN_WORDS } from "./words"

/** The `Tasks` fact: how many tasks run, succeeded and failed of the execution's; none when Google gives no count. */
function tasksFacts({ before }: ExecutionCancelPlan): CallFact[] {
  if (before.task_count === null) return []
  const { running, succeeded, failed, task_count: count } = before
  return [
    { label: RUN_WORDS.tasks, value: { text: RUN_WORDS.taskProgress, values: { running, succeeded, failed, count } } },
  ]
}

/**
 * What the prompt shows of a cancel: the headline, when the execution started
 * and how its tasks are doing. The execution's etag is a pin.
 */
export function describeExecutionCancel(plan: ExecutionCancelPlan): CallDescription {
  const { job, execution, before, etag } = plan
  return {
    headline: { text: RUN_WORDS.executionCancel, values: { execution, job } },
    facts: [
      { label: RUN_WORDS.started, value: before.start_time ?? phrase(RUN_WORDS.notStarted) },
      ...tasksFacts(plan),
    ],
    pins: etagPin(etag),
  }
}
