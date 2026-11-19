import { isRecord } from "../describe"
import { changeContainer, newContainer, recordAt, refuseMasked, type Json } from "./container-change"
import type { RunJobDeployArgs } from "./job-deploy-args"
import { timeoutText } from "./timeout"

/** The task count and parallelism of the execution template and the retries and timeout of its task template a call gives, set on a job; the keys it leaves out stay. */
function applyJobSettings(job: Json, args: RunJobDeployArgs): void {
  const execution = recordAt(job, "template")
  if (args.task_count !== undefined) execution.taskCount = args.task_count
  if (args.parallelism !== undefined) execution.parallelism = args.parallelism
  const task = recordAt(execution, "template")
  if (args.max_retries !== undefined) task.maxRetries = args.max_retries
  if (args.timeout_seconds !== undefined) task.timeout = timeoutText(args.timeout_seconds)
}

/** A new job: one container holding what the call gives, and nothing else, so Google's defaults apply. A variable to remove is refused, since there is nothing to remove from. */
export function newJob(args: RunJobDeployArgs): Json {
  const job: Json = { template: { template: { containers: [newContainer(args, "job")] } } }
  applyJobSettings(job, args)
  return job
}

/**
 * Google's own job with the call's changes, and the index of the container
 * changed. `jobs.patch` has no update mask and replaces the job, so the copy
 * is the whole job: every field the call does not change, labels, annotations
 * and unknown fields included, is sent back as it was. A job that holds a
 * value the client masked (shaped like a Google credential) is refused:
 * sending it back would replace the value with the mask.
 */
export function updatedJob(current: Json, args: RunJobDeployArgs): { job: Json; index: number } {
  const job = structuredClone(current)
  refuseMasked(job, "job")
  const execution = isRecord(job.template) ? job.template : {}
  const index = changeContainer(isRecord(execution.template) ? execution.template : {}, args, "job")
  applyJobSettings(job, args)
  return { job, index }
}
