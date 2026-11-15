import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { BATCH_GET_URL, SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { CLEAR_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CLEAR = { spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A2:B3", "'My Tab'!A:A"] }

const CURRENT = [["Old", "=A1"], []]

const CLEARED = { clearedRanges: ["Plan!A2:B3", "'My Tab'!A1:A1000"] }

const handlers = (current: unknown[][] = CURRENT) => [
  metadata(),
  valuesHandler(() => current),
  post(CLEAR_URL, CLEARED),
]

describe("google_sheets_clear", () => {
  test("returns the ranges Google cleared and every range as it was, formulas as written", async () => {
    const h = await writeFixture(handlers())

    expect(await h.clear(CLEAR)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      cleared: ["Plan!A2:B3", "'My Tab'!A1:A1000"],
      before: [
        { range: "Plan!A2:B3", values: [["Old", "=A1"], [""]] },
        { range: "'My Tab'!A:A", values: [["Old", "=A1"], [""]] },
      ],
      before_truncated: false,
    })
  })

  test("reads the tabs, then the cells as formulas, then clears them all in one call", async () => {
    const h = await writeFixture(handlers())

    await h.clear(CLEAR)

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${BATCH_GET_URL}`, `POST ${CLEAR_URL}`])
    const [read] = h.calls().slice(1)
    expect(read!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    expect(read!.url.searchParams.getAll("ranges")).toEqual(CLEAR.ranges)
    expect(writesOf(h.requests)).toHaveLength(1)
    expect(writesOf(h.requests)[0]!.json).toEqual({ ranges: CLEAR.ranges })
  })

  test("gives no before when the ranges hold more cells than a read returns, and still clears", async () => {
    const h = await writeFixture(handlers(Array.from({ length: 10_001 }, () => ["x"])))

    expect(await h.clear(CLEAR)).toMatchObject({ before: null, before_truncated: true })
    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("a reply with no cleared ranges lists none", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(CLEAR_URL)])

    expect(await h.clear(CLEAR)).toMatchObject({ cleared: [] })
  })

  test.each([
    ["no ranges", { ranges: [] }],
    ["more than 100 ranges", { ranges: Array.from({ length: 101 }, (_, index) => `A${index + 1}`) }],
    ["an empty range", { ranges: [""] }],
    ["a range over 500 characters", { ranges: ["A".repeat(501)] }],
    ["an unknown argument", { values: [] }],
  ])("refuses %s before any request", async (_name, change) => {
    const h = await writeFixture(handlers())

    await expect(h.clear({ ...CLEAR, ...change })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("a range that names no tab is refused with nothing cleared", async () => {
    const h = await writeFixture(handlers())

    await expect(h.clear({ ...CLEAR, ranges: ["Plan!A1", "Nope!A1"] })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(writesOf(h.requests)).toEqual([])
  })

  test("a label that only reads is unauthenticated before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.clear(CLEAR))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})
