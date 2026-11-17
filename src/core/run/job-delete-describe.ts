import type { CallDescription, CallFact } from "../tool"
import { countFact } from "./facts"
import type { JobDeletePlan } from "./job-delete-plan"
import { lastRunFacts } from "./job-run-describe"
import { etagPin } from "./pins"
import { RUN_WORDS } from "./words"

/**
 * What the prompt shows of a job's deletion: the headline, how many
 * executions it has, its last run and its image (when it has only one
 * container), since its executions go with it. The job's etag is a pin.
 */
export function describeJobDelete({ job, before, etag }: JobDeletePlan): CallDescription {
  const [only, ...others] = before.template.containers
  const facts: CallFact[] = [
    countFact(RUN_WORDS.executions, before.execution_count, RUN_WORDS.executionOne, RUN_WORDS.executionMany),
    ...lastRunFacts(before),
    ...(only === undefined || others.length > 0 ? [] : [{ label: RUN_WORDS.image, value: only.image }]),
  ]
  return {
    headline: { text: RUN_WORDS.jobDelete, values: { job } },
    facts,
    pins: etagPin(etag),
  }
}
