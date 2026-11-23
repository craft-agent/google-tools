import { describe, expect, test } from "bun:test"
import { executionSummary, executionView, taskView } from "./execution-view"
import { jobSummary } from "./job-view"

describe("Cloud Run omitted zero values", () => {
  test("execution and job counts default to zero in summary and full views", () => {
    const counts = { running: 0, succeeded: 0, failed: 0, cancelled: 0, retried: 0 }

    expect(executionSummary({})).toMatchObject(counts)
    expect(executionView({})).toMatchObject(counts)
    expect(jobSummary({})).toMatchObject({ execution_count: 0, latest_execution: null })
  })

  test("the first successful task has index and exit code zero when Google omits them", () => {
    expect(
      taskView({
        lastAttemptResult: {},
        conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
      }),
    ).toMatchObject({
      index: 0,
      retried: 0,
      status: "succeeded",
      last_attempt: { exit_code: 0, message: null },
    })
  })

  test("no last attempt remains null, and nonzero values are kept", () => {
    expect(taskView({}).last_attempt).toBeNull()
    expect(taskView({ index: 2, retried: 3, lastAttemptResult: { exitCode: 4 } })).toMatchObject({
      index: 2,
      retried: 3,
      last_attempt: { exit_code: 4, message: null },
    })
  })
})
