import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { MARKS, ON_SPREADSHEET, lookupsOf, mark, onColumns, onRows, onTab, searchHandler } from "./metadata.testing"
import { MAX_METADATA_ENTRIES } from "./metadata-read"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { METADATA_SEARCH_URL, SHEETS_WRITE_CREDENTIAL, metadata, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const LOCATION_TYPES = ["SPREADSHEET", "SHEET", "ROW", "COLUMN"]

/** A label logged in to write, which may search, a fake that answers the spreadsheet's tabs and a search over `marks`. */
const readFixture = (marks = MARKS) => writeFixture([metadata(), searchHandler(marks)], SHEETS_WRITE_CREDENTIAL)

const ids = (result: { metadata?: { metadata_id: number }[] }) => result.metadata!.map((entry) => entry.metadata_id)

describe("google_sheets_read: metadata", () => {
  test("lists every piece, by location then key, with where each sits, in one search with a lookup for each kind of location", async () => {
    const h = await readFixture()

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(result).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      metadata: [
        {
          metadata_id: 1,
          key: "owner",
          value: "finance",
          visibility: "document",
          location: { kind: "spreadsheet", tab: null, range: null },
        },
        {
          metadata_id: 2,
          key: "stage",
          value: "draft",
          visibility: "document",
          location: { kind: "tab", tab: "Plan", range: null },
        },
        {
          metadata_id: 8,
          key: "alpha",
          value: null,
          visibility: "document",
          location: { kind: "rows", tab: "Plan", range: "Plan!5:5" },
        },
        {
          metadata_id: 4,
          key: "order",
          value: "A-200",
          visibility: "document",
          location: { kind: "rows", tab: "Plan", range: "Plan!5:5" },
        },
        {
          metadata_id: 3,
          key: "order",
          value: "A-100",
          visibility: "document",
          location: { kind: "rows", tab: "Plan", range: "Plan!12:12" },
        },
        {
          metadata_id: 5,
          key: "region",
          value: "east",
          visibility: "document",
          location: { kind: "columns", tab: "Plan", range: "Plan!C:C" },
        },
        {
          metadata_id: 6,
          key: "stage",
          value: null,
          visibility: "project",
          location: { kind: "tab", tab: "My Tab", range: null },
        },
        {
          metadata_id: 7,
          key: "order",
          value: "B-1",
          visibility: "document",
          location: { kind: "rows", tab: "My Tab", range: "'My Tab'!1:1" },
        },
      ],
      more: 0,
    })
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${METADATA_SEARCH_URL}`])
    const search = h.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith(":search"))!
    expect(lookupsOf(search)).toEqual(LOCATION_TYPES.map((locationType) => ({ locationType })))
  })

  test("sends the key and the value to every lookup, and lists only what they select", async () => {
    const h = await readFixture()

    const byKey = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, key: "order" })
    const byBoth = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, key: "order", value: "A-100" })

    expect(ids(byKey)).toEqual([4, 3, 7])
    expect(ids(byBoth)).toEqual([3])
    const searches = h.requests.filter((request) => request.url.pathname.endsWith(":search"))
    expect(lookupsOf(searches[0]!)).toEqual(
      LOCATION_TYPES.map((locationType) => ({ locationType, metadataKey: "order" })),
    )
    expect(lookupsOf(searches[1]!)).toEqual(
      LOCATION_TYPES.map((locationType) => ({ locationType, metadataKey: "order", metadataValue: "A-100" })),
    )
  })

  test("keeps to the metadata on the tabs asked for and on their rows and columns, leaving the spreadsheet's own out", async () => {
    const h = await readFixture()

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, tabs: ["my tab"] })

    expect(ids(result)).toEqual([6, 7])
    expect(ids(await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, tabs: ["Plan", "a/b"] }))).toEqual([
      2, 8, 4, 3, 5,
    ])
  })

  test("refuses a tab the spreadsheet lacks, before any search", async () => {
    const h = await readFixture()

    const error = await toolError(h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, tabs: ["Nope"] }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("names no tab")
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`])
  })

  test("lists 200 entries and counts the rest, in order of location", async () => {
    const rows = Array.from({ length: MAX_METADATA_ENTRIES + 30 }, (_, row) =>
      mark(1000 + row, "order", onRows(0, row, row + 1), String(row)),
    )
    const h = await readFixture([...rows].reverse())

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(result.metadata).toHaveLength(MAX_METADATA_ENTRIES)
    expect(result.more).toBe(30)
    expect(result.metadata![0]!.location.range).toBe("Plan!1:1")
    expect(result.metadata![MAX_METADATA_ENTRIES - 1]!.location.range).toBe(
      `Plan!${MAX_METADATA_ENTRIES}:${MAX_METADATA_ENTRIES}`,
    )
  })

  test("lists a piece Google reports twice once, and nothing for an empty answer", async () => {
    const twice = mark(9, "owner", ON_SPREADSHEET, "finance")
    const h = await readFixture([twice, twice, mark(10, "x", onColumns(5, 0, 1))])

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(ids(result)).toEqual([9, 10])
    expect(result.metadata![1]!.location).toEqual({ kind: "columns", tab: "a/b", range: "'a/b'!A:A" })
    expect(ids(await (await readFixture([])).read({ method: "metadata", spreadsheet: SPREADSHEET_ID }))).toEqual([])
  })

  test.each([
    ["a range", { ranges: ["Plan!A1"] }, "ranges"],
    ["a pivots flag", { pivots: true }, "pivots"],
  ])("takes no %s", async (_name, extra, stray) => {
    const h = await readFixture()

    const error = await toolError(h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, ...extra }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`Method metadata takes no \`${stray}\`.`)
    expect(h.requests).toEqual([])
  })

  test("another method takes no key or value, and this one needs the spreadsheet", async () => {
    const h = await readFixture()

    const stray = await toolError(h.read({ method: "view", spreadsheet: SPREADSHEET_ID, key: "x" }))
    const missing = await toolError(h.read({ method: "metadata" }))

    expect(stray.message).toContain("Method view takes no `key`.")
    expect(missing.message).toContain("Method metadata needs `spreadsheet`.")
    expect(h.requests).toEqual([])
  })

  test("is upstream_error when Google's answer is not a list of matches", async () => {
    const h = await writeFixture(
      [metadata(), { method: "POST", url: METADATA_SEARCH_URL, reply: { json: { matchedDeveloperMetadata: "none" } } }],
      SHEETS_WRITE_CREDENTIAL,
    )

    const error = await toolError(h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID }))

    expect(error.code).toBe("upstream_error")
  })

  test("reads a tab's metadata whose id is 0 and a column Google gives no start for", async () => {
    const h = await readFixture([
      mark(1, "a", onTab(0)),
      mark(2, "b", onColumns(0, 0, 1)),
      mark(3, "c", onRows(0, 0, 1)),
    ])

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(result.metadata!.map((entry) => entry.location)).toEqual([
      { kind: "tab", tab: "Plan", range: null },
      { kind: "rows", tab: "Plan", range: "Plan!1:1" },
      { kind: "columns", tab: "Plan", range: "Plan!A:A" },
    ])
  })
})
