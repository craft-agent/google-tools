import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { ANNOTATION_VALUE, JOBS_URL, PARENT, condition, respond, templateSettings } from "./read.testing"
import { EXECUTION, JOB, TYPE_URL, operation } from "./write.testing"

/** Fixtures the Cloud Run job tests share: a job and its execution as Google gives them, the operations that change them and the handlers that answer for them. */

export const JOB_URL = `${JOBS_URL}/${JOB}`
export const EXECUTION_URL = `${JOB_URL}/executions/${EXECUTION}`

/** A made-up value Google's job holds that the tools do not know, which a deploy must send back as it is. */
export const FUTURE_FIELD = { nested: [1, 2, 3] }

/** A job as `jobs.get` gives it, with labels, annotations, a secret variable, volumes and keys the tools do not know. */
export const nightlyJob = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/jobs/${JOB}`,
  etag: '"job-etag-1"',
  labels: { team: "data" },
  annotations: { note: ANNOTATION_VALUE },
  generation: "3",
  creator: "dev@example.test",
  launchStage: "GA",
  futureField: FUTURE_FIELD,
  terminalCondition: condition("Ready", "CONDITION_SUCCEEDED"),
  executionCount: 12,
  latestCreatedExecution: {
    name: `${PARENT}/jobs/${JOB}/executions/${EXECUTION}`,
    createTime: "2026-05-30T01:00:00.000Z",
    completionTime: "2026-05-30T01:05:00.000Z",
    completionStatus: "EXECUTION_SUCCEEDED",
  },
  template: {
    taskCount: 4,
    parallelism: 2,
    labels: { run: "kept" },
    template: templateSettings({ maxRetries: 3, futureTaskKey: "kept" }),
  },
  ...extra,
})

/** An execution as `executions.get` gives it, still running. */
export const runningExecution = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/jobs/${JOB}/executions/${EXECUTION}`,
  job: JOB,
  etag: '"exec-etag-1"',
  annotations: { note: ANNOTATION_VALUE },
  createTime: "2026-05-30T01:00:00.000Z",
  startTime: "2026-05-30T01:00:05.000Z",
  taskCount: 4,
  parallelism: 2,
  runningCount: 2,
  succeededCount: 1,
  failedCount: 0,
  conditions: [condition("Completed", "CONDITION_PENDING")],
  template: templateSettings({ maxRetries: 3 }),
  ...extra,
})

/** An operation that is done, with the job it changed as its response. */
export const finishedJob = (job: Record<string, unknown> = nightlyJob()) =>
  operation({ done: true, response: { "@type": `${TYPE_URL}.Job`, ...job } })

/** An operation that is done, with the execution it changed as its response. */
export const finishedExecution = (execution: Record<string, unknown> = runningExecution()) =>
  operation({ done: true, response: { "@type": `${TYPE_URL}.Execution`, ...execution } })

/** The reply to a run: an operation still going, whose metadata is the execution it started. */
export const runStarted = (execution: Record<string, unknown> = runningExecution()) =>
  operation({ metadata: { "@type": `${TYPE_URL}.Execution`, ...execution } })

/** `GET` of the job, answering `reply`. */
export const jobHandler = (reply: FakeReply = { json: nightlyJob() }): FakeHandler => respond(JOB_URL, reply)

/** `PATCH` of the job, answering `reply`. */
export const jobPatchHandler = (reply: FakeHandler["reply"] = { json: finishedJob() }): FakeHandler => ({
  method: "PATCH",
  url: JOB_URL,
  reply,
})

/** `POST` that creates a job, answering `reply`. */
export const jobCreateHandler = (reply: FakeHandler["reply"] = { json: finishedJob() }): FakeHandler => ({
  method: "POST",
  url: JOBS_URL,
  reply,
})

/** `POST` that runs the job, answering `reply`. */
export const runHandler = (reply: FakeHandler["reply"] = { json: runStarted() }): FakeHandler => ({
  method: "POST",
  url: `${JOB_URL}:run`,
  reply,
})

/** `GET` of the execution, answering `reply`. */
export const executionHandler = (reply: FakeReply = { json: runningExecution() }): FakeHandler =>
  respond(EXECUTION_URL, reply)

/** `POST` that cancels the execution, answering `reply`. */
export const cancelHandler = (reply: FakeHandler["reply"] = { json: finishedExecution() }): FakeHandler => ({
  method: "POST",
  url: `${EXECUTION_URL}:cancel`,
  reply,
})
