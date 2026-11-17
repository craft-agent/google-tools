import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OPERATION_ID,
  SECRET_VALUE,
  SERVICE_URL,
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
  splitTraffic,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SPLIT = [
  { revision: "api-00007-abc", percent: 70, tag: "stable" },
  { latest: true, percent: 20 },
  { revision: "api-00006-xyz", percent: 10 },
]

const SENT_TRAFFIC = [
  { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00007-abc", percent: 70, tag: "stable" },
  { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 20 },
  { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00006-xyz", percent: 10 },
]

describe("google_run_traffic_set", () => {
  test("sends one PATCH that updates the traffic alone, with the etag it read", async () => {
    const h = await writeFixture({ handlers: [serviceHandler({ json: apiService(splitTraffic()) }), patchHandler()] })

    await h.traffic.run({ traffic: SPLIT })

    expect(h.calls().map(callOf)).toEqual([`GET ${SERVICE_URL}`, `PATCH ${SERVICE_URL}`])
    const [patch] = h.writes()
    expect(Object.fromEntries(patch!.url.searchParams)).toEqual({ updateMask: "traffic" })
    expect(patch!.json).toEqual({ traffic: SENT_TRAFFIC, etag: '"etag-1"' })
  })

  test("returns the service once done, the traffic it had before and the operation, with no environment value", async () => {
    const h = await writeFixture({ handlers: [serviceHandler({ json: apiService(splitTraffic()) }), patchHandler()] })

    const result = await h.traffic.run({ traffic: [{ latest: true, percent: 100 }] })

    expect(result.before).toEqual({
      traffic: [
        { type: "revision", revision: "api-00007-abc", percent: 90, tag: null },
        { type: "revision", revision: "api-00006-xyz", percent: 10, tag: "canary" },
      ],
      traffic_statuses: [
        { type: "revision", revision: "api-00007-abc", percent: 90, tag: null, uri: null },
        { type: "revision", revision: "api-00006-xyz", percent: 10, tag: "canary", uri: null },
      ],
    })
    expect(result.service).toMatchObject({ service: "api" })
    expect(result.operation).toEqual({ operation: OPERATION_ID, done: true })
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE)
  })

  test("follows the operation it is given until it is done", async () => {
    const h = await writeFixture({
      handlers: [serviceHandler(), patchHandler({ json: operation() }), operationHandler({ json: finished() })],
    })

    const result = await h.traffic.waiting({ traffic: [{ latest: true, percent: 100 }] }, { waitMs: 60_000, pollMs: 1 })

    expect(h.calls().map(callOf)).toContain(`GET ${operationUrl()}`)
    expect(result.service).toMatchObject({ service: "api" })
  })

  test("returns no service while the operation is still running at the deadline", async () => {
    let h!: Awaited<ReturnType<typeof writeFixture>>
    h = await writeFixture({
      handlers: [
        serviceHandler(),
        patchHandler({ json: operation() }),
        operationHandler(() => {
          h.clock.advance(1000)
          return { json: operation() }
        }),
      ],
    })

    const result = await h.traffic.waiting({ traffic: [{ latest: true, percent: 100 }] }, { waitMs: 1500, pollMs: 1 })

    expect(result.service).toBeNull()
    expect(result.operation).toEqual({ operation: OPERATION_ID, done: false })
    expect(result.before.traffic).toHaveLength(1)
  })

  test("a conflict is stale, and a service that is gone is not_found with nothing sent", async () => {
    const conflict = await writeFixture({
      handlers: [serviceHandler(), patchHandler(refusal(409, "ABORTED", "The service was changed."))],
    })
    expect((await toolError(conflict.traffic.run({ traffic: [{ latest: true, percent: 100 }] }))).code).toBe("stale")

    const gone = await writeFixture({ handlers: [serviceHandler(refusal(404, "NOT_FOUND"))] })
    expect((await toolError(gone.traffic.run({ traffic: [{ latest: true, percent: 100 }] }))).code).toBe("not_found")
    expect(gone.writes()).toEqual([])
  })

  test("a failed operation is upstream_error with Google's message", async () => {
    const h = await writeFixture({
      handlers: [
        serviceHandler(),
        patchHandler({ json: operation({ done: true, error: { code: 3, message: "Revision does not exist." } }) }),
      ],
    })

    const error = await toolError(h.traffic.run({ traffic: [{ latest: true, percent: 100 }] }))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Revision does not exist")
    expect(error.details).toEqual({ operation: OPERATION_ID, google_code: 3 })
  })

  test("the target is the service", async () => {
    const h = await writeFixture()

    expect(await h.traffic.targets({ traffic: SPLIT })).toEqual([
      "work/projects/my-proj/locations/asia-northeast1/services/api",
    ])
  })
})
