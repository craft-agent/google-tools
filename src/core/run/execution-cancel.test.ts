import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { EXECUTION_URL, cancelHandler, executionHandler, finishedExecution, runningExecution } from "./jobs.testing"
import { RUN_CREDENTIAL } from "./read.testing"
import {
  OPERATION_ID,
  SECRET_VALUE,
  callOf,
  cleanUp,
  freshTokens,
  operation,
  operationHandler,
  operationUrl,
  refusal,
  writeFixture,
  type WriteFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FAST = { waitMs: 60_000, pollMs: 1 }

const STALE_MESSAGE = "The execution changed since it was read; nothing was cancelled. Read it again and retry."

const STARTED = { json: operation() }

const cancelled = () => runningExecution({ runningCount: 0, cancelledCount: 3, completionTime: "2026-05-30T01:09:00Z" })

const callsOf = (h: WriteFixture) => h.calls().map(callOf)

describe("google_run_execution_cancel", () => {
  test("reads the execution, then sends one POST of the cancel with the etag it read", async () => {
    const h = await writeFixture({ handlers: [executionHandler(), cancelHandler()] })

    await h.cancel.run()

    expect(callsOf(h)).toEqual([`GET ${EXECUTION_URL}`, `POST ${EXECUTION_URL}:cancel`])
    const [post] = h.writes()
    expect([...post!.url.searchParams]).toEqual([])
    expect(post!.json).toEqual({ etag: '"exec-etag-1"' })
  })

  test("an execution with no etag is cancelled without one", async () => {
    const h = await writeFixture({
      handlers: [executionHandler({ json: runningExecution({ etag: undefined }) }), cancelHandler()],
    })

    await h.cancel.run()

    expect(h.writes()[0]!.json).toEqual({})
  })

  test("returns the execution once the cancel is done and the operation, with no environment value", async () => {
    const h = await writeFixture({
      handlers: [executionHandler(), cancelHandler({ json: finishedExecution(cancelled()) })],
    })

    const result = await h.cancel.run()

    expect(callsOf(h).filter((call) => call.includes("/operations/"))).toEqual([])
    expect(result).toMatchObject({
      execution: { execution: "nightly-abc12", cancelled: 3, running: 0 },
      operation: { operation: OPERATION_ID, done: true },
    })
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE)
  })

  test("follows the operation until it is done and takes the execution from its response", async () => {
    const h = await writeFixture({
      handlers: [
        executionHandler(),
        cancelHandler(STARTED),
        operationHandler({ json: finishedExecution(cancelled()) }),
      ],
    })

    const result = await h.cancel.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(1)
    expect(result).toMatchObject({ execution: { cancelled: 3 }, operation: { operation: OPERATION_ID, done: true } })
  })

  test("one still running at the deadline is returned as its id with done false and no execution", async () => {
    let h!: WriteFixture
    h = await writeFixture({
      handlers: [
        executionHandler(),
        cancelHandler(STARTED),
        operationHandler(() => {
          h.clock.advance(1000)
          return STARTED
        }),
      ],
    })

    const result = await h.cancel.waiting({}, { waitMs: 2500, pollMs: 1 })

    expect(result).toEqual({ execution: null, operation: { operation: OPERATION_ID, done: false } })
  })

  test("an execution that has finished is refused, and nothing is sent", async () => {
    const h = await writeFixture({
      handlers: [
        executionHandler({ json: runningExecution({ completionTime: "2026-05-30T01:05:00Z" }) }),
        cancelHandler(),
      ],
    })

    const error = await toolError(h.cancel.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe('"nightly-abc12" has already finished; nothing to cancel.')
    expect(h.writes()).toEqual([])
  })

  test("an execution that does not exist is not_found, and an id that is not a short name is refused before any request", async () => {
    const gone = await writeFixture({ handlers: [executionHandler(refusal(404, "NOT_FOUND")), cancelHandler()] })
    expect((await toolError(gone.cancel.run())).code).toBe("not_found")
    expect(gone.writes()).toEqual([])

    const bad = await writeFixture({ handlers: [executionHandler(), cancelHandler()] })
    expect((await toolError(bad.cancel.run({ execution: "a/b" }))).code).toBe("invalid_argument")
    expect((await toolError(bad.cancel.run({ job: "Nightly" }))).code).toBe("invalid_argument")
    expect(bad.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: [executionHandler(), cancelHandler()], credential: RUN_CREDENTIAL })

    expect((await toolError(h.cancel.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The execution was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing cancelled", async (_name, reply) => {
    const h = await writeFixture({ handlers: [executionHandler(), cancelHandler(reply)] })

    const error = await toolError(h.cancel.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [executionHandler(), cancelHandler(refusal(403, "PERMISSION_DENIED", "No permission."))],
    })
    expect((await toolError(denied.cancel.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [executionHandler(), cancelHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.cancel.run())).code).toBe("upstream_error")
  })
})
