import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  FAST,
  REVISION_URL,
  STARTED,
  callsOf,
  deletedOperation,
  oldRevision,
  revisionDeleteHandler,
  revisionHandler,
} from "./delete.testing"
import { RUN_CREDENTIAL } from "./read.testing"
import {
  OPERATION_ID,
  SERVICE_URL,
  cleanUp,
  freshTokens,
  operationHandler,
  operationUrl,
  refusal,
  serviceHandler,
  writeFixture,
  type WriteFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The revision changed since it was read; nothing was deleted. Read it again and retry."

const handlers = () => [serviceHandler(), revisionHandler(), revisionDeleteHandler()]

describe("google_run_revision_delete", () => {
  test("reads the service and the revision, then sends one DELETE with the revision's etag as a query", async () => {
    const h = await writeFixture({ handlers: handlers() })

    await h.revisionDelete.run()

    expect(callsOf(h)).toEqual([`GET ${SERVICE_URL}`, `GET ${REVISION_URL}`, `DELETE ${REVISION_URL}`])
    const [request] = h.writes()
    expect([...request!.url.searchParams]).toEqual([["etag", '"rev-etag-1"']])
    expect(request!.json).toBeUndefined()
  })

  test("a revision with no etag is deleted without the query", async () => {
    const h = await writeFixture({
      handlers: [
        serviceHandler(),
        revisionHandler({ json: oldRevision({ etag: undefined }) }),
        revisionDeleteHandler(),
      ],
    })

    await h.revisionDelete.run()

    expect([...h.writes()[0]!.url.searchParams]).toEqual([])
  })

  test("returns the revision, whether it is deleted and the operation, when the reply is already done", async () => {
    const h = await writeFixture({ handlers: handlers() })

    const result = await h.revisionDelete.run()

    expect(callsOf(h).filter((call) => call.includes("/operations/"))).toEqual([])
    expect(result).toEqual({
      revision: "api-00005-old",
      deleted: true,
      operation: { operation: OPERATION_ID, done: true },
    })
  })

  test("follows the operation until it is done", async () => {
    const h = await writeFixture({
      handlers: [
        serviceHandler(),
        revisionHandler(),
        revisionDeleteHandler(STARTED),
        operationHandler({ json: deletedOperation() }),
      ],
    })

    const result = await h.revisionDelete.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(1)
    expect(result).toMatchObject({ deleted: true, operation: { operation: OPERATION_ID, done: true } })
  })

  test("one still running at the deadline is returned with deleted false", async () => {
    let h!: WriteFixture
    h = await writeFixture({
      handlers: [
        serviceHandler(),
        revisionHandler(),
        revisionDeleteHandler(STARTED),
        operationHandler(() => {
          h.clock.advance(1000)
          return STARTED
        }),
      ],
    })

    const result = await h.revisionDelete.waiting({}, { waitMs: 2500, pollMs: 1 })

    expect(result).toEqual({
      revision: "api-00005-old",
      deleted: false,
      operation: { operation: OPERATION_ID, done: false },
    })
  })

  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The revision was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing deleted", async (_name, reply) => {
    const h = await writeFixture({ handlers: [serviceHandler(), revisionHandler(), revisionDeleteHandler(reply)] })

    const error = await toolError(h.revisionDelete.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a revision that does not exist is not_found, and an id that is not a short name is refused before any request", async () => {
    const gone = await writeFixture({
      handlers: [serviceHandler(), revisionHandler(refusal(404, "NOT_FOUND")), revisionDeleteHandler()],
    })
    expect((await toolError(gone.revisionDelete.run())).code).toBe("not_found")
    expect(gone.writes()).toEqual([])

    const bad = await writeFixture({ handlers: handlers() })
    expect((await toolError(bad.revisionDelete.run({ revision: "a/b" }))).code).toBe("invalid_argument")
    expect((await toolError(bad.revisionDelete.run({ service: "Api" }))).code).toBe("invalid_argument")
    expect(bad.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: handlers(), credential: RUN_CREDENTIAL })

    expect((await toolError(h.revisionDelete.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [serviceHandler(), revisionHandler(), revisionDeleteHandler(refusal(403, "PERMISSION_DENIED"))],
    })
    expect((await toolError(denied.revisionDelete.run())).code).toBe("forbidden")

    const failed = await writeFixture({
      handlers: [serviceHandler(), revisionHandler(), revisionDeleteHandler(refusal(500, "INTERNAL"))],
    })
    expect((await toolError(failed.revisionDelete.run())).code).toBe("upstream_error")
  })
})
