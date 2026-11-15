import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { appendUrl, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const APPENDED = { updates: { updatedRange: "Plan!A6:C7", updatedRows: 2, updatedCells: 6 } }

const APPEND = {
  spreadsheet: SPREADSHEET_ID,
  range: "Plan!A:C",
  values: [
    ["Pens", 3, true],
    ["Ink", null, ""],
  ],
}

describe("google_sheets_append: a range", () => {
  test("returns the tab as Google names it and what Google wrote", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Plan!A:C"), APPENDED)])

    expect(await h.append(APPEND)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      tab: "Plan",
      updated_range: "Plan!A6:C7",
      updated_rows: 2,
      updated_cells: 6,
    })
  })

  test("reads the tabs, then appends the rows as given with new rows inserted and no values back", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Plan!A:C"), APPENDED)])

    await h.append(APPEND)

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${appendUrl("Plan!A:C")}`])
    expect(h.calls()[0]!.url.searchParams.get("fields")).toBe(
      "properties(title),sheets(properties(sheetId,title,index,hidden))",
    )
    const [write] = writesOf(h.requests)
    expect(write!.url.searchParams.get("valueInputOption")).toBe("USER_ENTERED")
    expect(write!.url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS")
    expect(write!.url.searchParams.get("includeValuesInResponse")).toBe("false")
    expect(write!.json).toEqual({ values: APPEND.values })
  })

  test("raw stores the values as given", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Plan!A:C"), APPENDED)])

    await h.append({ ...APPEND, raw: true })

    expect(writesOf(h.requests)[0]!.url.searchParams.get("valueInputOption")).toBe("RAW")
  })

  test("encodes a quoted range with spaces and colons, and names its tab", async () => {
    const range = "'My Tab'!A1:C"
    const h = await writeFixture([metadata(), post(appendUrl(range), APPENDED)])

    const result = await h.append({ ...APPEND, range })

    expect(result.tab).toBe("My Tab")
    expect(writesOf(h.requests)[0]!.url.pathname).toBe(
      `/v4/spreadsheets/${SPREADSHEET_ID}/values/'My%20Tab'!A1%3AC:append`,
    )
  })

  test.each([
    ["cells with no tab", "A1:C", "Plan"],
    ["a tab's name alone", "Plan", "Plan"],
    ["a tab's title in other letters", "my tab!A1", "My Tab"],
  ])("takes %s as %s", async (_name, range, tab) => {
    const h = await writeFixture([metadata(), post(appendUrl(range), APPENDED)])

    expect((await h.append({ ...APPEND, range })).tab).toBe(tab)
  })

  test("a reply with no updates counts nothing", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Plan!A:C"))])

    expect(await h.append(APPEND)).toMatchObject({ updated_range: null, updated_rows: 0, updated_cells: 0 })
  })

  test("refuses a range with a slash in the tab title as invalid_argument, naming the table form, before any request", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("'a/b'!A:C"), APPENDED)])

    const error = await toolError(h.append({ ...APPEND, range: "'a/b'!A:C" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`/` cannot be appended to by `range`")
    expect(error.message).toContain("`table` form")
    expect(h.requests).toEqual([])
  })

  test("a range that names no tab is refused with nothing written", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Nope!A:C"), APPENDED)])

    await expect(h.append({ ...APPEND, range: "Nope!A:C" })).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("names no tab"),
    })
    expect(writesOf(h.requests)).toEqual([])
  })
})

describe("google_sheets_append: arguments", () => {
  test.each([
    ["neither a range nor a table", { range: undefined }, "exactly one of `range` or `table`"],
    ["both a range and a table", { table: "Orders" }, "exactly one of `range` or `table`"],
    ["no rows", { values: [] }, "values"],
    ["an empty row", { values: [["x"], []] }, "values"],
    ["a cell that is none of text, a number or a boolean", { values: [[[1]]] }, "values"],
    [
      "more than 10000 cells",
      { values: [Array.from({ length: 10_001 }, () => 1)] },
      "values: holds more than 10000 cells",
    ],
    ["an empty range", { range: "" }, "range"],
    ["an unknown argument", { note: "x" }, "note"],
  ])("refuses %s before any request", async (_name, change, message) => {
    const h = await writeFixture([metadata()])

    const error = await toolError(h.append({ ...APPEND, ...change }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(h.requests).toEqual([])
  })

  test("takes exactly 10000 cells", async () => {
    const h = await writeFixture([metadata(), post(appendUrl("Plan!A:C"), APPENDED)])

    await h.append({ ...APPEND, values: [Array.from({ length: 10_000 }, () => 1)] })

    expect(writesOf(h.requests)).toHaveLength(1)
  })
})
