import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { MARKS, guardHandlers, holds, lookupsOf, mark, onRows } from "./metadata.testing"
import { BATCH_GET_URL, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { METADATA_SEARCH_URL, UPDATE_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** Runs an edit guarded by `guards` that is refused as stale; returns its error once it has checked that nothing was written. */
async function stale(guards: unknown[], marks = MARKS) {
  const h = await writeFixture(guardHandlers(marks))
  const error = await toolError(h.edit(holds(...guards)))
  expect(error.code).toBe("stale")
  expect(writesOf(h.requests)).toEqual([])
  return { h, error }
}

describe("expect with metadata: the check", () => {
  test("holds when the row of the cell carries the mark, whichever cell of the row names it", async () => {
    const h = await writeFixture(guardHandlers())

    await h.edit(
      holds(
        { range: "Plan!A12", metadata: { key: "order", value: "A-100" } },
        { range: "Plan!Z12", metadata: { key: "order" } },
        { range: "'My Tab'!B1", metadata: { key: "order", value: "B-1" }, along: "rows" },
      ),
    )

    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("sends one search for every distinct key, value and direction, right before the write", async () => {
    const h = await writeFixture(guardHandlers())

    await h.edit(
      holds(
        { range: "Plan!A12", metadata: { key: "order", value: "A-100" } },
        { range: "Plan!B12", metadata: { key: "order", value: "A-100" } },
        { range: "Plan!A5", metadata: { key: "order" } },
        { range: "Plan!C1", metadata: { key: "region" }, along: "columns" },
      ),
    )

    expect(h.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `POST ${METADATA_SEARCH_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${UPDATE_URL}`,
    ])
    const search = h.requests.find((request) => request.url.pathname.endsWith(":search"))!
    expect(lookupsOf(search)).toEqual([
      { metadataKey: "order", metadataValue: "A-100", locationType: "ROW" },
      { metadataKey: "order", locationType: "ROW" },
      { metadataKey: "region", locationType: "COLUMN" },
    ])
  })

  test("refuses as stale when the row does not carry it, saying where the mark is, and writes nothing", async () => {
    const { error } = await stale([{ range: "Plan!A13", metadata: { key: "order", value: "A-100" } }])

    expect(error.message).toBe(
      'Nothing was written: the cells the call expected differ (the rows may have moved; read them again): Plan!A13: expected "order=A-100", found "rows 12–12 carry it"',
    )
    expect(error.details).toEqual({
      differs: [{ range: "Plan!A13", expected: "order=A-100", found: "rows 12–12 carry it" }],
    })
  })

  test("says that no row carries a mark nobody has, naming the key alone when no value was given", async () => {
    const { error } = await stale([{ range: "Plan!A5", metadata: { key: "gone" } }])

    expect(error.details).toEqual({ differs: [{ range: "Plan!A5", expected: "gone", found: "no row carries it" }] })
  })

  test("refuses a value that differs, though the key is on the row", async () => {
    const { error } = await stale([{ range: "Plan!A12", metadata: { key: "order", value: "A-200" } }])

    expect(error.details).toEqual({
      differs: [{ range: "Plan!A12", expected: "order=A-200", found: "rows 5–5 carry it" }],
    })
  })

  test("keeps to the tab of the cell: a mark on another tab does not hold the row", async () => {
    const { error } = await stale([{ range: "Plan!A1", metadata: { key: "order", value: "B-1" } }])

    expect(error.details).toEqual({
      differs: [{ range: "Plan!A1", expected: "order=B-1", found: "no row carries it" }],
    })
  })

  test("names up to three places, nearest the top first, and counts the rest", async () => {
    const rows = [9, 3, 7, 1, 5].map((row, position) => mark(100 + position, "tag", onRows(0, row, row + 1)))

    const { error } = await stale([{ range: "Plan!A20", metadata: { key: "tag" } }], rows)

    expect(error.details).toEqual({
      differs: [{ range: "Plan!A20", expected: "tag", found: "rows 2–2, 4–4, 6–6 (+2 more) carry it" }],
    })
  })

  test("looks along columns when asked, and says so", async () => {
    const h = await writeFixture(guardHandlers())
    await h.edit(holds({ range: "Plan!C1", metadata: { key: "region", value: "east" }, along: "columns" }))

    const { error } = await stale([
      { range: "Plan!D1", metadata: { key: "region" }, along: "columns" },
      { range: "Plan!C1", metadata: { key: "nothing" }, along: "columns" },
    ])

    expect(error.details).toEqual({
      differs: [
        { range: "Plan!D1", expected: "region", found: "columns C–C carry it" },
        { range: "Plan!C1", expected: "nothing", found: "no column carries it" },
      ],
    })
  })

  test("a row mark does not hold a column guard, nor a column mark a row guard", async () => {
    const { error } = await stale([
      { range: "Plan!C1", metadata: { key: "order" }, along: "columns" },
      { range: "Plan!A5", metadata: { key: "region" } },
    ])

    expect((error.details!.differs as unknown[]).length).toBe(2)
  })

  test("holds for a mark that sits on several rows only where its rows cover the cell", async () => {
    const wide = [mark(50, "block", onRows(0, 9, 14))]
    const h = await writeFixture(guardHandlers(wide))

    await h.edit(holds({ range: "Plan!A14", metadata: { key: "block" } }))
    const { error } = await stale([{ range: "Plan!A15", metadata: { key: "block" } }], wide)

    expect(writesOf(h.requests)).toHaveLength(1)
    expect(error.details).toEqual({ differs: [{ range: "Plan!A15", expected: "block", found: "rows 10–14 carry it" }] })
  })

  test("is invalid_argument for a cell on a tab the spreadsheet lacks, with nothing written", async () => {
    const h = await writeFixture(guardHandlers())

    const error = await toolError(h.edit(holds({ range: "Nope!A1", metadata: { key: "order" } })))

    expect(error.code).toBe("invalid_argument")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("is upstream_error when Google's answer is not a list of matches", async () => {
    const h = await writeFixture([
      metadata(),
      { method: "POST", url: METADATA_SEARCH_URL, reply: { json: { matchedDeveloperMetadata: 3 } } },
      post(UPDATE_URL),
    ])

    const error = await toolError(h.edit(holds({ range: "Plan!A12", metadata: { key: "order" } })))

    expect(error.code).toBe("upstream_error")
    expect(writesOf(h.requests)).toEqual([])
  })
})
