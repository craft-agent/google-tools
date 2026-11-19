import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { RUN_CREDENTIAL } from "./read.testing"
import { cleanUp, freshTokens, patchHandler, serviceHandler, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ revision: `api-0000${index}-abc`, percent: index === 0 ? 100 : 0 }))

const NOTHING = () => [serviceHandler(), patchHandler()]

describe("google_run_traffic_set: a split that cannot be", () => {
  test.each([
    ["an entry with neither a revision nor latest", [{ percent: 100 }], "exactly one"],
    ["an entry with both", [{ revision: "api-00001-abc", latest: true, percent: 100 }], "exactly one"],
    ["percents that add up to less than 100", [{ revision: "api-00001-abc", percent: 99 }], "add up to 99"],
    [
      "percents that add up to more than 100",
      [
        { revision: "api-00001-abc", percent: 60 },
        { latest: true, percent: 41 },
      ],
      "add up to 101",
    ],
    [
      "a revision twice",
      [
        { revision: "api-00001-abc", percent: 50 },
        { revision: "api-00001-abc", percent: 50 },
      ],
      "more than once",
    ],
    [
      "a tag twice",
      [
        { revision: "api-00001-abc", percent: 50, tag: "blue" },
        { latest: true, percent: 50, tag: "blue" },
      ],
      "blue",
    ],
    ["a revision that is a path", [{ revision: "services/api/revisions/x", percent: 100 }], "short name"],
  ])("refuses %s before any request", async (_name, traffic, hint) => {
    const h = await writeFixture({ handlers: NOTHING() })

    const error = await toolError(h.traffic.run({ traffic }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test.each([
    ["no entry", []],
    ["more than 20 entries", entries(21)],
    ["a percent over 100", [{ latest: true, percent: 101 }]],
    ["a percent that is not whole", [{ latest: true, percent: 99.5 }]],
    ["a latest that is false", [{ latest: false, percent: 100 }]],
    ["a tag that is not a tag", [{ latest: true, percent: 100, tag: "Not_A_Tag" }]],
    ["a tag that starts with a digit", [{ latest: true, percent: 100, tag: "1st" }]],
    ["an entry key it does not take", [{ latest: true, percent: 100, name: "x" }]],
  ])("refuses %s as invalid_argument", async (_name, traffic) => {
    const h = await writeFixture({ handlers: NOTHING() })

    expect((await toolError(h.traffic.run({ traffic }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("accepts 20 entries, a tag of 46 characters and a share of zero", async () => {
    const h = await writeFixture({ handlers: NOTHING() })
    const tag = `a${"b".repeat(44)}c`

    await h.traffic.run({ traffic: [...entries(19), { latest: true, percent: 0, tag }] })

    expect(h.writes()).toHaveLength(1)
  })

  test("a service id that is not a short name is refused before any request", async () => {
    const h = await writeFixture({ handlers: NOTHING() })

    expect((await toolError(h.traffic.run({ service: "a/b", traffic: [{ latest: true, percent: 100 }] }))).code).toBe(
      "invalid_argument",
    )
    expect(h.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: NOTHING(), credential: RUN_CREDENTIAL })

    const error = await toolError(h.traffic.run({ traffic: [{ latest: true, percent: 100 }] }))

    expect(error.code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })
})
