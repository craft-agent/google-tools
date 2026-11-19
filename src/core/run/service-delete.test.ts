import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { FAST, STARTED, callsOf, deletedOperation, serviceDeleteHandler } from "./delete.testing"
import { PLACE, RUN_CREDENTIAL } from "./read.testing"
import { googleRunServiceDelete } from "./service-delete"
import {
  OPERATION_ID,
  SERVICE_URL,
  apiService,
  cleanUp,
  followsLatest,
  freshTokens,
  operationHandler,
  operationUrl,
  refusal,
  serviceHandler,
  splitTraffic,
  writeFixture,
  type WriteFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The service changed since it was read; nothing was deleted. Read it again and retry."

const URI = "https://api-abc123-an.a.run.app"

async function described(service = apiService({ uri: URI })) {
  const h = await writeFixture({ handlers: [serviceHandler({ json: service })] })
  return { h, description: await h.serviceDelete.describe() }
}

describe("google_run_service_delete", () => {
  test("reads the service, then sends one DELETE with the etag it read as a query", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler()] })

    await h.serviceDelete.run()

    expect(callsOf(h)).toEqual([`GET ${SERVICE_URL}`, `DELETE ${SERVICE_URL}`])
    expect([...h.writes()[0]!.url.searchParams]).toEqual([["etag", '"etag-1"']])
    expect(h.writes()[0]!.json).toBeUndefined()
  })

  test("a service with no etag is deleted without the query", async () => {
    const h = await writeFixture({
      handlers: [serviceHandler({ json: apiService({ etag: undefined }) }), serviceDeleteHandler()],
    })

    await h.serviceDelete.run()

    expect([...h.writes()[0]!.url.searchParams]).toEqual([])
  })

  test("returns the service, whether it is deleted and the operation", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler()] })

    expect(await h.serviceDelete.run()).toEqual({
      service: "api",
      deleted: true,
      operation: { operation: OPERATION_ID, done: true },
    })
  })

  test("follows the operation until it is done", async () => {
    const h = await writeFixture({
      handlers: [serviceHandler(), serviceDeleteHandler(STARTED), operationHandler({ json: deletedOperation() })],
    })

    const result = await h.serviceDelete.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(1)
    expect(result).toMatchObject({ deleted: true })
  })

  test("one still running at the deadline is returned with deleted false", async () => {
    let h!: WriteFixture
    h = await writeFixture({
      handlers: [
        serviceHandler(),
        serviceDeleteHandler(STARTED),
        operationHandler(() => {
          h.clock.advance(1000)
          return STARTED
        }),
      ],
    })

    const result = await h.serviceDelete.waiting({}, { waitMs: 2500, pollMs: 1 })

    expect(result).toEqual({ service: "api", deleted: false, operation: { operation: OPERATION_ID, done: false } })
  })

  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The service was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing deleted", async (_name, reply) => {
    const h = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler(reply)] })

    const error = await toolError(h.serviceDelete.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a service that does not exist is not_found, and an id that is not a short name is refused before any request", async () => {
    const gone = await writeFixture({ handlers: [serviceHandler(refusal(404, "NOT_FOUND")), serviceDeleteHandler()] })
    expect((await toolError(gone.serviceDelete.run())).code).toBe("not_found")
    expect(gone.writes()).toEqual([])

    const bad = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler()] })
    expect((await toolError(bad.serviceDelete.run({ service: "a/b" }))).code).toBe("invalid_argument")
    expect(bad.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler()], credential: RUN_CREDENTIAL })

    expect((await toolError(h.serviceDelete.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [serviceHandler(), serviceDeleteHandler(refusal(403, "PERMISSION_DENIED"))],
    })
    expect((await toolError(denied.serviceDelete.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [serviceHandler(), serviceDeleteHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.serviceDelete.run())).code).toBe("upstream_error")
  })
})

describe("google_run_service_delete describe", () => {
  test("headlines the service from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to delete the service {service} with every revision",
      values: { service: "api" },
    })
  })

  test("shows the URL, the traffic served now and the latest revision", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "URL", value: URI },
      { label: "Traffic now", value: "latest (api-00007-abc) 100%" },
      { label: "Latest revision", value: "api-00007-abc" },
    ])
    expect(description.text).toBeUndefined()
  })

  test("shows the traffic served as the traffic tool's Now fact does", async () => {
    const { description } = await described(apiService({ uri: URI, ...splitTraffic() }))

    expect(description.facts[1]).toEqual({ label: "Traffic now", value: "api-00007-abc 90%, api-00006-xyz 10%" })
  })

  test("leaves out the URL and the latest revision Google does not give, and says there is no traffic", async () => {
    const { description } = await described(
      apiService({ latestReadyRevision: undefined, trafficStatuses: [], traffic: followsLatest().traffic }),
    )

    expect(description.facts).toEqual([{ label: "Traffic now", value: { text: "no traffic" } }])
  })

  test("pins the etag, as absent when there is none, and a changed etag changes the pins", async () => {
    expect((await described()).description.pins).toEqual({ etag: '"etag-1"' })
    expect((await described(apiService({ etag: '"etag-2"' }))).description.pins).toEqual({ etag: '"etag-2"' })
    expect((await described(apiService({ etag: undefined }))).description.pins).toEqual({ etag: "absent" })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ handlers: [serviceHandler()] })

    const whole = await wholeCallDescription(googleRunServiceDelete, { ...PLACE, service: "api" }, h.ctx)

    expect(whole?.pins).toEqual({ etag: '"etag-1"' })
  })

  test("throws where execute would: a service that is gone", async () => {
    const gone = await writeFixture({ handlers: [serviceHandler(refusal(404, "NOT_FOUND"))] })

    expect((await toolError(gone.serviceDelete.describe())).code).toBe("not_found")
  })

  test("the target is the service, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.serviceDelete.targets()).toEqual(["work/projects/my-proj/locations/asia-northeast1/services/api"])
    expect(h.requests).toEqual([])
    expect(await h.serviceDelete.targets({ service: "a/b" })).toEqual(["*"])
  })
})
