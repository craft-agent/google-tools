import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  MARKS,
  ON_SPREADSHEET,
  marksSpreadsheetHandler,
  mark,
  onColumns,
  onRows,
  onTab,
  searchHandler,
} from "./metadata.testing"
import { MAX_METADATA_ENTRIES } from "./metadata-read"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { METADATA_SEARCH_URL, SHEETS_WRITE_CREDENTIAL, metadata, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The mask the marks are read with: no cell values. */
const MARKS_FIELDS =
  "developerMetadata,sheets(properties(sheetId,title,index),developerMetadata,data(rowMetadata(developerMetadata),columnMetadata(developerMetadata)))"

/** A label that can only read, whose marks come from the spreadsheet itself. */
const readOnly = (marks = MARKS) => writeFixture([marksSpreadsheetHandler(marks)], SHEETS_CREDENTIAL)

/** A label that may write, whose marks come from a search. */
const searching = (marks = MARKS) => writeFixture([metadata(), searchHandler(marks)], SHEETS_WRITE_CREDENTIAL)

const ids = (result: { metadata?: { metadata_id: number }[] }) => result.metadata!.map((entry) => entry.metadata_id)

describe("google_sheets_read: metadata under the read scope", () => {
  test("sends no search, and reads the spreadsheet with the field mask that takes no cell values", async () => {
    const h = await readOnly()

    await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${SPREADSHEET_URL}`])
    expect(h.calls().map((request) => request.url.searchParams.get("fields"))).toEqual([
      "properties(title),sheets(properties(sheetId,title,index,hidden))",
      MARKS_FIELDS,
    ])
    expect(h.calls().every((request) => !request.url.searchParams.has("includeGridData"))).toBe(true)
  })

  test("answers what the search answers, from the marks of all four placements", async () => {
    const calls = [
      {},
      { key: "order" },
      { key: "order", value: "A-100" },
      { value: "finance" },
      { key: "stage", value: "nothing" },
      { tabs: ["my tab"] },
      { tabs: ["Plan", "a/b"], key: "order" },
    ]
    for (const extra of calls) {
      const args = { method: "metadata", spreadsheet: SPREADSHEET_ID, ...extra }

      const fromGet = await (await readOnly()).read(args)
      const fromSearch = await (await searching()).read(args)

      expect(fromGet).toEqual(fromSearch)
    }
    const all = await (await readOnly()).read({ method: "metadata", spreadsheet: SPREADSHEET_ID })
    expect(ids(all)).toEqual([1, 2, 8, 4, 3, 5, 6, 7])
  })

  test("matches a key and a value exactly, as the search does", async () => {
    const h = await readOnly([
      mark(1, "Order", onRows(0, 0, 1), "A-1"),
      mark(2, "order", onRows(0, 1, 2), "a-1"),
      mark(3, "order", onRows(0, 2, 3), "A-1"),
      mark(4, "order", onRows(0, 3, 4), "A-1 "),
      mark(5, "order", onRows(0, 4, 5)),
    ])

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, key: "order", value: "A-1" })

    expect(ids(result)).toEqual([3])
    expect(ids(await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, key: "order" }))).toEqual([2, 3, 4, 5])
  })

  test("lists a mark on several rows once, where it starts, and a tab with the id 0 and a column with no start", async () => {
    const h = await readOnly([
      mark(1, "block", onRows(0, 9, 14)),
      mark(2, "a", onTab(0)),
      mark(3, "b", onColumns(0, 0, 1)),
      mark(4, "x", onColumns(5, 0, 1)),
    ])

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(result.metadata!.map((entry) => [entry.metadata_id, entry.location])).toEqual([
      [2, { kind: "tab", tab: "Plan", range: null }],
      [1, { kind: "rows", tab: "Plan", range: "Plan!10:14" }],
      [3, { kind: "columns", tab: "Plan", range: "Plan!A:A" }],
      [4, { kind: "columns", tab: "a/b", range: "'a/b'!A:A" }],
    ])
  })

  test("lists 200 entries and counts the rest, as the search does", async () => {
    const rows = Array.from({ length: MAX_METADATA_ENTRIES + 30 }, (_, row) =>
      mark(1000 + row, "order", onRows(0, row, row + 1), String(row)),
    )

    const result = await (await readOnly([...rows].reverse())).read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(result.metadata).toHaveLength(MAX_METADATA_ENTRIES)
    expect(result.more).toBe(30)
    expect(result.metadata![0]!.location.range).toBe("Plan!1:1")
  })

  test("says nothing for a spreadsheet with no marks, and refuses a tab it lacks before reading them", async () => {
    const h = await readOnly([])

    const empty = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })
    const error = await toolError(h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID, tabs: ["Nope"] }))

    expect(empty).toEqual({ spreadsheet_id: SPREADSHEET_ID, metadata: [], more: 0 })
    expect(error.code).toBe("invalid_argument")
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${SPREADSHEET_URL}`, `GET ${SPREADSHEET_URL}`])
  })

  test("is upstream_error when Google's answer is not in the shape of the marks", async () => {
    const h = await writeFixture(
      [{ method: "GET", url: SPREADSHEET_URL, reply: { json: { developerMetadata: "none" } } }],
      SHEETS_CREDENTIAL,
    )

    const error = await toolError(h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID }))

    expect(error.code).toBe("upstream_error")
  })
})

describe("google_sheets_read: metadata under the write scope", () => {
  test("searches, as before, and reads the spreadsheet only for its tabs", async () => {
    const h = await searching([mark(1, "owner", ON_SPREADSHEET, "finance")])

    const result = await h.read({ method: "metadata", spreadsheet: SPREADSHEET_ID })

    expect(ids(result)).toEqual([1])
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${METADATA_SEARCH_URL}`])
  })
})
