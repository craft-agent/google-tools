import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleRunExecutionCancel } from "./execution-cancel"
import { executionHandler, runningExecution } from "./jobs.testing"
import { PLACE } from "./read.testing"
import { cleanUp, freshTokens, refusal, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(execution = runningExecution()) {
  const h = await writeFixture({ handlers: [executionHandler({ json: execution })] })
  return { h, description: await h.cancel.describe() }
}

describe("google_run_execution_cancel describe", () => {
  test("headlines the execution and its job from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to cancel the execution {execution} of {job}",
      values: { execution: "nightly-abc12", job: "nightly" },
    })
  })

  test("shows when it started and how its tasks are doing", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Started", value: "2026-05-30T01:00:05.000Z" },
      {
        label: "Tasks",
        value: {
          text: "{running} running, {succeeded} succeeded, {failed} failed of {count}",
          values: { running: 2, succeeded: 1, failed: 0, count: 4 },
        },
      },
    ])
    expect(description.text).toBeUndefined()
  })

  test("says an execution has not started, and leaves out the tasks when Google gives no count", async () => {
    const { description } = await described(runningExecution({ startTime: undefined, taskCount: undefined }))

    expect(description.facts).toEqual([{ label: "Started", value: { text: "not started" } }])
  })

  test("pins the etag, as absent when there is none", async () => {
    expect((await described()).description.pins).toEqual({ etag: '"exec-etag-1"' })
    expect((await described(runningExecution({ etag: '"exec-etag-2"' }))).description.pins).toEqual({
      etag: '"exec-etag-2"',
    })
    expect((await described(runningExecution({ etag: undefined }))).description.pins).toEqual({ etag: "absent" })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ handlers: [executionHandler()] })

    const whole = await wholeCallDescription(
      googleRunExecutionCancel,
      { ...PLACE, job: "nightly", execution: "nightly-abc12" },
      h.ctx,
    )

    expect(whole?.facts).toHaveLength(2)
    expect(whole?.pins).toEqual({ etag: '"exec-etag-1"' })
  })

  test("throws where execute would: an execution that has finished or is gone", async () => {
    const done = await writeFixture({
      handlers: [executionHandler({ json: runningExecution({ completionTime: "2026-05-30T01:05:00Z" }) })],
    })
    expect((await toolError(done.cancel.describe())).code).toBe("invalid_argument")

    const gone = await writeFixture({ handlers: [executionHandler(refusal(404, "NOT_FOUND"))] })
    expect((await toolError(gone.cancel.describe())).code).toBe("not_found")
  })

  test("the target is the execution, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.cancel.targets()).toEqual([
      "work/projects/my-proj/locations/asia-northeast1/jobs/nightly/executions/nightly-abc12",
    ])
    expect(h.requests).toEqual([])
    expect(await h.cancel.targets({ execution: "a/b" })).toEqual(["*"])
  })
})
