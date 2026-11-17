import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { JOB_URL, finishedExecution, jobHandler, nightlyJob, runHandler, runningExecution } from "./jobs.testing"
import { SECRET_VALUE } from "./read.testing"
import { callOf, cleanUp, container, freshTokens, operation, templateSettings, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call overrides, which no result may hold. */
const SENT_VALUE = "request-made-up-env-value"

const ETAG = '"job-etag-1"'

async function started(args: Record<string, unknown> = {}, job: Record<string, unknown> = nightlyJob()) {
  const h = await writeFixture({ handlers: [jobHandler({ json: job }), runHandler()] })
  const result = await h.jobRun.run(args)
  const [post] = h.writes()
  return { h, result, post: post!, body: post!.json as { etag?: string; overrides?: Record<string, any> } }
}

describe("google_run_job_run", () => {
  test("sends one POST of the run with the etag it read and no overrides when none are given", async () => {
    const { h, post, body } = await started()

    expect(h.calls().map(callOf)).toEqual([`GET ${JOB_URL}`, `POST ${JOB_URL}:run`])
    expect([...post.url.searchParams]).toEqual([])
    expect(body).toEqual({ etag: ETAG })
  })

  test("sends the overrides it is given, for the one container, and never the job's own settings", async () => {
    const { body } = await started({
      env: { MODE: SENT_VALUE, EMPTY: "" },
      args: ["--once", "now"],
      task_count: 2,
      timeout_seconds: 90,
    })

    expect(body).toEqual({
      etag: ETAG,
      overrides: {
        containerOverrides: [
          {
            name: "app",
            env: [
              { name: "MODE", value: SENT_VALUE },
              { name: "EMPTY", value: "" },
            ],
            args: ["--once", "now"],
          },
        ],
        taskCount: 2,
        timeout: "90s",
      },
    })
  })

  test("clears the arguments with clearArgs, and sends no container override for a task count alone", async () => {
    const cleared = await started({ args: [] })
    expect(cleared.body.overrides).toEqual({ containerOverrides: [{ name: "app", clearArgs: true }] })

    const counted = await started({ task_count: 7 })
    expect(counted.body.overrides).toEqual({ taskCount: 7 })
  })

  test("names the container among several, and leaves the name out of one that has none", async () => {
    const several = nightlyJob({
      template: {
        taskCount: 4,
        template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }),
      },
    })
    const named = await started({ container: "sidecar", args: ["x"] }, several)
    expect(named.body.overrides).toEqual({ containerOverrides: [{ name: "sidecar", args: ["x"] }] })

    const unnamed = nightlyJob({
      template: { template: templateSettings({ containers: [container({ name: undefined })] }) },
    })
    const bare = await started({ env: { A: "1" } }, unnamed)
    expect(bare.body.overrides).toEqual({ containerOverrides: [{ env: [{ name: "A", value: "1" }] }] })
  })

  test("a task count alone needs no container named when the job has several", async () => {
    const several = nightlyJob({
      template: { template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }) },
    })

    const { body } = await started({ task_count: 3 }, several)

    expect(body.overrides).toEqual({ taskCount: 3 })
  })

  test("a job with no etag is run without one", async () => {
    const { body } = await started({}, nightlyJob({ etag: undefined }))

    expect(body).toEqual({})
  })

  test("returns at once with the execution from the operation's metadata, asking for the operation never", async () => {
    const { h, result } = await started({ env: { MODE: SENT_VALUE } })

    expect(h.calls().map(callOf)).toEqual([`GET ${JOB_URL}`, `POST ${JOB_URL}:run`])
    expect(result).toMatchObject({
      execution: { execution: "nightly-abc12", job: "nightly", task_count: 4, running: 2, succeeded: 1 },
      operation: { operation: "op-1", done: false },
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
  })

  test("uses the response when the operation is already done, and no execution when the reply holds none", async () => {
    const response = runningExecution({ name: `${runningExecution().name.replace("abc12", "done9")}` })
    const done = await writeFixture({ handlers: [jobHandler(), runHandler({ json: finishedExecution(response) })] })
    expect(await done.jobRun.run()).toMatchObject({
      execution: { execution: "nightly-done9" },
      operation: { operation: "op-1", done: true },
    })

    for (const reply of [operation(), operation({ metadata: { "@type": "type.googleapis.com/x", note: "y" } })]) {
      const h = await writeFixture({ handlers: [jobHandler(), runHandler({ json: reply })] })
      expect(await h.jobRun.run()).toEqual({ execution: null, operation: { operation: "op-1", done: false } })
    }
  })

  test("takes the metadata when the finished operation's response is not an execution", async () => {
    const reply = operation({
      done: true,
      response: { "@type": "type.googleapis.com/x" },
      metadata: runningExecution(),
    })
    const h = await writeFixture({ handlers: [jobHandler(), runHandler({ json: reply })] })

    expect(await h.jobRun.run()).toMatchObject({ execution: { execution: "nightly-abc12" }, operation: { done: true } })
  })
})
