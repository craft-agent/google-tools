import type { CallDescription, CallFact, CallHeadline } from "../tool"
import { SETTINGS, changeLines, containerLines, containerPins, keptFacts, textOf } from "./container-describe"
import { phrase } from "./facts"
import type { JobDeployPlan } from "./job-deploy-plan"
import { etagPin } from "./pins"
import { timeoutText } from "./timeout"
import { RUN_WORDS } from "./words"

/** The words that begin a line of the changes, one per setting only a job has. */
const JOB_SETTINGS = { tasks: "tasks", parallelism: "parallelism", retries: "retries" } as const

function headline({ mode, job, args }: JobDeployPlan): CallHeadline {
  const text = mode === "create" ? RUN_WORDS.jobDeployCreate : RUN_WORDS.jobDeployUpdate
  return { text, values: { image: args.image, job } }
}

function facts({ before, container }: JobDeployPlan): CallFact[] {
  if (before === null || container === null) {
    return [{ label: RUN_WORDS.newJob, value: phrase(RUN_WORDS.newJobDefaults) }]
  }
  return [{ label: RUN_WORDS.imageNow, value: container.image }, ...keptFacts(before.template)]
}

/**
 * The lines of the changes, in a fixed order: the image, each variable (named,
 * never its value), then each setting the call gives. On an update a line
 * reads `<old> → <new>`, with `-` for what was not set; on a new job, only the
 * new value.
 */
function changeTexts({ args, before, container }: JobDeployPlan): string[] {
  const lines = changeLines(before !== null && container !== null)
  const { setting } = lines

  return [
    ...containerLines(args, container, lines),
    ...setting(
      SETTINGS.timeout,
      textOf(before?.template.timeout),
      args.timeout_seconds === undefined ? undefined : timeoutText(args.timeout_seconds),
    ),
    ...setting(JOB_SETTINGS.tasks, textOf(before?.task_count), args.task_count),
    ...setting(JOB_SETTINGS.parallelism, textOf(before?.parallelism), args.parallelism),
    ...setting(JOB_SETTINGS.retries, textOf(before?.template.max_retries), args.max_retries),
  ]
}

/**
 * What the prompt shows of a job deploy: the headline, the image now and what
 * the deploy keeps (or, for a new job, the default it gets), and every change
 * as a line, with no variable's value. The job's etag, the container's name
 * and a digest of its variables' names and kinds are pins.
 */
export function describeJobDeploy(plan: JobDeployPlan): CallDescription {
  const { args, container, etag } = plan
  return {
    headline: headline(plan),
    facts: facts(plan),
    text: { label: RUN_WORDS.changes, body: changeTexts(plan).join("\n") },
    pins: { ...etagPin(etag), ...containerPins(container, args.container) },
  }
}
