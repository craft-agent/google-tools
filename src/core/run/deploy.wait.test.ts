import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { runDeployInput } from "./deploy-args"
import { deployService } from "./deploy"
import {
  OPERATION_ID,
  OWN_IMAGE,
  PLACE,
  apiService,
  callOf,
  cleanUp,
  finished,
  freshTokens,
  operation,
  operationHandler,
  operationUrl,
  patchHandler,
  refusal,
  serviceHandler,
  writeFixture,
  type WriteFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FAST = { waitMs: 60_000, pollMs: 1 }

const STARTED = { json: operation() }

const REVISION_TEXT = "Revision failed to start."

/** The calls of a deploy that waited, with the service read and the change sent first. */
const callsOf = (h: WriteFixture) => h.calls().map(callOf)

describe("google_run_service_deploy: waiting for the operation", () => {
  test("an operation that is done in the first reply is not asked about", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), patchHandler({ json: finished() })] })

    const result = await h.deploy.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call.includes("/operations/"))).toEqual([])
    expect(result.operation).toEqual({ operation: OPERATION_ID, done: true })
    expect(result.service).toMatchObject({ service: "api" })
  })

  test("one that is done after a poll is asked about once and its response is the service", async () => {
    const polled = apiService({ latestCreatedRevision: "projects/p/locations/r/services/api/revisions/api-00009-new" })
    const h = await writeFixture({
      handlers: [serviceHandler(), patchHandler(STARTED), operationHandler({ json: finished(polled) })],
    })

    const result = await h.deploy.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(1)
    expect(result).toMatchObject({
      revision: "api-00009-new",
      operation: { operation: OPERATION_ID, done: true },
    })
  })

  test("one still running at the deadline is returned as its id with done false and no service", async () => {
    let h!: WriteFixture
    h = await writeFixture({
      handlers: [
        serviceHandler(),
        patchHandler(STARTED),
        operationHandler(() => {
          h.clock.advance(1000)
          return STARTED
        }),
      ],
    })

    const result = await h.deploy.waiting({}, { waitMs: 2500, pollMs: 1 })

    expect(result).toMatchObject({
      created: false,
      service: null,
      revision: null,
      before: { image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1" },
      operation: { operation: OPERATION_ID, done: false },
    })
    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(3)
  })

  test("a deadline that has passed before the first poll asks nothing", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), patchHandler(STARTED)] })

    const result = await h.deploy.waiting({}, { waitMs: 0, pollMs: 1 })

    expect(result.operation).toEqual({ operation: OPERATION_ID, done: false })
    expect(callsOf(h).filter((call) => call.includes("/operations/"))).toEqual([])
  })

  test.each([
    [
      "in the reply to the change",
      [patchHandler({ json: operation({ done: true, error: { code: 9, message: REVISION_TEXT } }) })],
    ],
    [
      "found by a poll",
      [
        patchHandler(STARTED),
        operationHandler({ json: operation({ done: true, error: { code: 9, message: REVISION_TEXT } }) }),
      ],
    ],
  ])("an operation that failed %s is upstream_error with Google's message and its id", async (_name, handlers) => {
    const h = await writeFixture({ handlers: [serviceHandler(), ...handlers] })

    const error = await toolError(h.deploy.waiting({}, FAST))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "Google reported the change failed: Revision failed to start. Read what it changed with google_run_read to see what was left.",
    )
    expect(error.details).toEqual({ operation: OPERATION_ID, google_code: 9 })
  })

  test("a change that names no operation is an error that says to read what it changed", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), patchHandler({ json: { done: true } })] })

    const error = await toolError(h.deploy.waiting({}, FAST))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("with google_run_read to see what was left")
  })

  test("a cancellation while waiting is the call's cancellation, and nothing more is asked", async () => {
    const h = await writeFixture({
      handlers: [serviceHandler(), patchHandler(STARTED), operationHandler(STARTED)],
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)

    const args = runDeployInput.parse({ ...PLACE, service: "api", image: OWN_IMAGE })
    const error = await toolError(
      deployService(args, { ...h.ctx, signal: controller.signal }, { waitMs: 60_000, pollMs: 10_000 }),
    )

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `The call was cancelled after Google started the change (operation ${OPERATION_ID}). Follow it with google_run_read method \`operation\` before trying again.`,
    )
    expect(error.details).toEqual({ operation: OPERATION_ID })
    expect(error.cause).toBeDefined()
    expect(callsOf(h).filter((call) => call.includes("/operations/"))).toEqual([])
  })

  test.each([
    ["500", refusal(500, "INTERNAL", "Backend error."), "upstream_error" as const],
    ["429", refusal(429, "RESOURCE_EXHAUSTED", "Quota spent."), "rate_limited" as const],
  ])(
    "a poll that answers %s after the write was accepted says the change was started, with the poll's code",
    async (status, reply, code) => {
      const h = await writeFixture({ handlers: [serviceHandler(), patchHandler(STARTED), operationHandler(reply)] })

      const error = await toolError(h.deploy.waiting({}, FAST))

      expect(error.code).toBe(code)
      expect(error.message).toStartWith(
        `Google started the change (operation ${OPERATION_ID}), but following it failed: `,
      )
      expect(error.message).toMatch(/(Backend error|Quota spent)\. Follow it with google_run_read method `operation`/)
      expect(error.details).toMatchObject({ operation: OPERATION_ID, status: Number(status) })
      expect(error.cause).toBeInstanceOf(Error)
      expect(h.writes()).toHaveLength(1)
    },
  )

  test("a failed operation found by a poll keeps its own message, not the started one", async () => {
    const h = await writeFixture({
      handlers: [
        serviceHandler(),
        patchHandler(STARTED),
        operationHandler({ json: operation({ done: true, error: { code: 9, message: REVISION_TEXT } }) }),
      ],
    })

    const error = await toolError(h.deploy.waiting({}, FAST))

    expect(error.message).toStartWith("Google reported the change failed")
  })
})
