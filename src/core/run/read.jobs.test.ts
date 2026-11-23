import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANNOTATION_VALUE,
  JOBS_URL,
  PARENT,
  SECRET_VALUE,
  answer,
  cleanUp,
  condition,
  fixture,
  freshTokens,
  templateSettings,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const JOB_URL = `${JOBS_URL}/nightly`
const EXECUTIONS_URL = `${JOB_URL}/executions`
const EXECUTION_URL = `${EXECUTIONS_URL}/nightly-abc12`
const TASKS_URL = `${EXECUTION_URL}/tasks`

/** A job as `jobs.get` gives it. */
const nightlyJob = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/jobs/nightly`,
  labels: { team: "data" },
  annotations: { note: ANNOTATION_VALUE },
  generation: "3",
  createTime: "2026-05-01T09:30:00.000Z",
  updateTime: "2026-05-30T08:00:00.000Z",
  creator: "dev@example.test",
  lastModifier: "ci@example.test",
  launchStage: "GA",
  reconciling: false,
  terminalCondition: condition("Ready", "CONDITION_SUCCEEDED"),
  conditions: [condition("Ready", "CONDITION_SUCCEEDED")],
  executionCount: 12,
  latestCreatedExecution: {
    name: `${PARENT}/jobs/nightly/executions/nightly-abc12`,
    createTime: "2026-05-30T01:00:00.000Z",
    completionTime: "2026-05-30T01:05:00.000Z",
    completionStatus: "EXECUTION_FAILED",
  },
  template: {
    taskCount: 4,
    parallelism: 2,
    template: templateSettings({ maxRetries: 3 }),
  },
  ...extra,
})

/** An execution as `executions.get` gives it. */
const nightlyExecution = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/jobs/nightly/executions/nightly-abc12`,
  job: "nightly",
  createTime: "2026-05-30T01:00:00.000Z",
  startTime: "2026-05-30T01:00:05.000Z",
  completionTime: "2026-05-30T01:05:00.000Z",
  taskCount: 4,
  parallelism: 2,
  runningCount: 0,
  succeededCount: 3,
  failedCount: 1,
  cancelledCount: 0,
  retriedCount: 2,
  logUri: "https://console.cloud.google.com/logs/viewer?y=2",
  annotations: { note: ANNOTATION_VALUE },
  conditions: [
    condition("Completed", "CONDITION_FAILED", { executionReason: "NON_ZERO_EXIT_CODE", message: "Exit 1." }),
  ],
  template: templateSettings({ maxRetries: 3 }),
  ...extra,
})

describe("google_run_read jobs", () => {
  test("lists the jobs as summaries with the latest execution", async () => {
    const h = await fixture([
      answer(JOBS_URL, {
        jobs: [nightlyJob(), { name: `${PARENT}/jobs/fresh`, latestCreatedExecution: {} }],
        nextPageToken: "n",
      }),
    ])

    expect(await h.read({ method: "jobs" })).toEqual({
      jobs: [
        {
          job: "nightly",
          ready: { state: "succeeded", reason: null, message: null, time: "2026-05-30T08:00:00.000Z" },
          update_time: "2026-05-30T08:00:00.000Z",
          last_modifier: "ci@example.test",
          execution_count: 12,
          latest_execution: {
            execution: "nightly-abc12",
            status: "failed",
            create_time: "2026-05-30T01:00:00.000Z",
            completion_time: "2026-05-30T01:05:00.000Z",
          },
        },
        {
          job: "fresh",
          ready: { state: "unknown", reason: null, message: null, time: null },
          update_time: null,
          last_modifier: null,
          execution_count: 0,
          latest_execution: null,
        },
      ],
      next_page_token: "n",
    })
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({ pageSize: "50" })
  })
})

describe("google_run_read job", () => {
  test("an empty latest execution reference means the job has never run", async () => {
    const h = await fixture([answer(JOB_URL, nightlyJob({ latestCreatedExecution: {} }))])

    expect(await h.read({ method: "job", job: "nightly" })).toMatchObject({ latest_execution: null })
  })

  test("returns the job with its task template, and no environment value or annotation", async () => {
    const h = await fixture([answer(JOB_URL, nightlyJob())])

    const result = await h.read({ method: "job", job: "nightly" })

    expect(result).toMatchObject({
      job: "nightly",
      labels: { team: "data" },
      generation: "3",
      reconciling: false,
      creator: "dev@example.test",
      launch_stage: "GA",
      task_count: 4,
      parallelism: 2,
      template: { max_retries: 3, timeout: "300s", service_account: "runner@my-proj.iam.gserviceaccount.com" },
    })
    expect(result.template).toMatchObject({
      containers: [
        {
          env: [
            { name: "PLAIN", kind: "value" },
            { name: "TOKEN", kind: "secret" },
          ],
        },
      ],
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(ANNOTATION_VALUE)
  })
})

describe("google_run_read executions", () => {
  test("lists a job's executions with counts and how each ended", async () => {
    const h = await fixture([
      answer(EXECUTIONS_URL, { executions: [nightlyExecution(), { name: `${PARENT}/jobs/nightly/executions/e2` }] }),
    ])

    const result = await h.read({ method: "executions", job: "nightly", limit: 2 })

    expect(result.executions).toEqual([
      {
        execution: "nightly-abc12",
        create_time: "2026-05-30T01:00:00.000Z",
        start_time: "2026-05-30T01:00:05.000Z",
        completion_time: "2026-05-30T01:05:00.000Z",
        task_count: 4,
        running: 0,
        succeeded: 3,
        failed: 1,
        cancelled: 0,
        retried: 2,
        status: "failed",
        log_uri: "https://console.cloud.google.com/logs/viewer?y=2",
      },
      {
        execution: "e2",
        create_time: null,
        start_time: null,
        completion_time: null,
        task_count: null,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        retried: 0,
        status: "unknown",
        log_uri: null,
      },
    ])
    expect(result.next_page_token).toBeNull()
  })

  test("a run still going is running, a stopped one cancelled", async () => {
    const running = nightlyExecution({ conditions: [condition("Completed", "CONDITION_RECONCILING")] })
    const stopped = nightlyExecution({
      conditions: [condition("Completed", "CONDITION_FAILED", { executionReason: "CANCELLED" })],
    })
    const h = await fixture([answer(EXECUTIONS_URL, { executions: [running, stopped] })])

    const result = await h.read({ method: "executions", job: "nightly" })

    expect(result.executions?.map((entry) => entry.status)).toEqual(["running", "cancelled"])
  })
})

describe("google_run_read execution", () => {
  test("returns the execution with its conditions and template, and no environment value", async () => {
    const h = await fixture([answer(EXECUTION_URL, nightlyExecution())])

    const result = await h.read({ method: "execution", job: "nightly", execution: "nightly-abc12" })

    expect(result).toMatchObject({
      execution: "nightly-abc12",
      job: "nightly",
      parallelism: 2,
      status: "failed",
      template: { max_retries: 3, containers: [{ env: [{ name: "PLAIN", kind: "value" }, { name: "TOKEN" }] }] },
    })
    expect(result.conditions).toEqual([
      {
        type: "Completed",
        state: "failed",
        reason: "NON_ZERO_EXIT_CODE",
        message: "Exit 1.",
        time: "2026-05-30T08:00:00.000Z",
      },
    ])
    const text = JSON.stringify(result)
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(ANNOTATION_VALUE)
  })
})

describe("google_run_read tasks", () => {
  test("lists an execution's tasks with the last attempt's exit code and message", async () => {
    const h = await fixture([
      answer(TASKS_URL, {
        tasks: [
          {
            name: `${PARENT}/jobs/nightly/executions/nightly-abc12/tasks/nightly-abc12-0`,
            index: 0,
            retried: 1,
            startTime: "2026-05-30T01:00:05.000Z",
            completionTime: "2026-05-30T01:01:00.000Z",
            logUri: "https://console.cloud.google.com/logs/viewer?z=3",
            conditions: [condition("Completed", "CONDITION_FAILED")],
            lastAttemptResult: { exitCode: 1, status: { code: 2, message: "Container failed." } },
          },
          { name: `${PARENT}/jobs/nightly/executions/nightly-abc12/tasks/nightly-abc12-1` },
        ],
      }),
    ])

    const result = await h.read({ method: "tasks", job: "nightly", execution: "nightly-abc12" })

    expect(result.tasks).toEqual([
      {
        task: "nightly-abc12-0",
        index: 0,
        retried: 1,
        start_time: "2026-05-30T01:00:05.000Z",
        completion_time: "2026-05-30T01:01:00.000Z",
        status: "failed",
        last_attempt: { exit_code: 1, message: "Container failed." },
        log_uri: "https://console.cloud.google.com/logs/viewer?z=3",
      },
      {
        task: "nightly-abc12-1",
        index: 0,
        retried: 0,
        start_time: null,
        completion_time: null,
        status: "unknown",
        last_attempt: null,
        log_uri: null,
      },
    ])
  })
})
