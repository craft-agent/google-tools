import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleRunTrafficSet } from "./traffic"
import {
  PLACE,
  apiService,
  cleanUp,
  followsLatest,
  freshTokens,
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

async function described(service = apiService(), traffic: unknown[] = SPLIT) {
  const h = await writeFixture({ handlers: [serviceHandler({ json: service })] })
  return { h, description: await h.traffic.describe({ traffic }) }
}

describe("google_run_traffic_set describe", () => {
  test("headlines the service from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({ text: "About to set the traffic of {service}", values: { service: "api" } })
  })

  test("shows the traffic served now, the latest with the revision it is, and no tags when there are none", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([{ label: "Now", value: "latest (api-00007-abc) 100%" }])
  })

  test("shows each revision served with its share, and counts the tags the service has", async () => {
    const { description } = await described(apiService(splitTraffic()))

    expect(description.facts).toEqual([
      { label: "Now", value: "api-00007-abc 90%, api-00006-xyz 10%" },
      { label: "Tags", value: { text: "{count} tag", values: { count: 1 } } },
    ])
  })

  test("counts each tag once and in the plural for several", async () => {
    const service = apiService({
      traffic: [
        { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00007-abc", percent: 100, tag: "a" },
        { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00006-xyz", percent: 0, tag: "b" },
      ],
      trafficStatuses: [
        { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00007-abc", percent: 100, tag: "a" },
      ],
    })

    const { description } = await described(service)

    expect(description.facts[1]).toEqual({ label: "Tags", value: { text: "{count} tags", values: { count: 2 } } })
  })

  test("a service that serves nothing says so, and a latest with no revision named is shown as latest", async () => {
    const none = await described(apiService({ trafficStatuses: [] }))
    expect(none.description.facts[0]).toEqual({ label: "Now", value: { text: "no traffic" } })

    const bare = await described(
      apiService({ trafficStatuses: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }] }),
    )
    expect(bare.description.facts[0]).toEqual({ label: "Now", value: "latest 100%" })
  })

  test("lists the new split as a line per entry, with the tag", async () => {
    const { description } = await described()

    expect(description.text).toEqual({
      label: "New traffic",
      body: ["api-00007-abc: 70% (tag stable)", "latest: 20%", "api-00006-xyz: 10%"].join("\n"),
    })
  })

  test("pins the etag, which changes when the service does", async () => {
    const before = (await described()).description.pins
    expect(before).toEqual({ etag: '"etag-1"' })
    expect((await described()).description.pins).toEqual(before)
    expect((await described(apiService({ etag: '"etag-2"' }))).description.pins).toEqual({ etag: '"etag-2"' })
    expect((await described(apiService({ etag: undefined }))).description.pins).toEqual({ etag: "absent" })
  })

  test("is a description the prompt can use, and says the same for traffic that follows the latest", async () => {
    const h = await writeFixture({ handlers: [serviceHandler({ json: apiService(followsLatest()) })] })

    const whole = await wholeCallDescription(
      googleRunTrafficSet,
      { ...PLACE, service: "api", traffic: [{ latest: true, percent: 100 }] },
      h.ctx,
    )

    expect(whole?.facts).toHaveLength(1)
    expect(whole?.pins).toEqual({ etag: '"etag-1"' })
  })

  test("throws where execute would: a service that is gone, a split that cannot be", async () => {
    const gone = await writeFixture({ handlers: [serviceHandler(refusal(404, "NOT_FOUND"))] })
    expect((await toolError(gone.traffic.describe({ traffic: SPLIT }))).code).toBe("not_found")

    const bad = await writeFixture({ handlers: [serviceHandler()] })
    expect((await toolError(bad.traffic.describe({ traffic: [{ latest: true, percent: 50 }] }))).code).toBe(
      "invalid_argument",
    )
  })
})
