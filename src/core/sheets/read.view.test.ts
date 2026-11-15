import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, callOf, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const VIEW = { method: "view", spreadsheet: SPREADSHEET_ID }

const BOOK = {
  spreadsheetId: SPREADSHEET_ID,
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
  properties: { title: "Budget 2026", locale: "en_US", timeZone: "Europe/Paris" },
  sheets: [
    {
      properties: {
        title: "Plan",
        gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 },
      },
      tables: [
        { tableId: "t-1", name: "Costs", range: { endRowIndex: 10, endColumnIndex: 3 } },
        {
          tableId: "t-2",
          name: "Wide",
          range: { startRowIndex: 2, endRowIndex: 8, startColumnIndex: 25, endColumnIndex: 28 },
        },
      ],
    },
    {
      properties: {
        sheetId: 77,
        title: "It's old",
        index: 1,
        hidden: true,
        gridProperties: { rowCount: 50, columnCount: 5, frozenColumnCount: 2 },
      },
      tables: [{ tableId: "t-3", name: "Old", range: { endRowIndex: 4, endColumnIndex: 2 } }],
    },
    { properties: { sheetId: 5, title: "2026", index: 2 } },
  ],
}

describe("google_sheets_read view", () => {
  test("maps the structure of the spreadsheet and its tabs", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    expect(await h.read(VIEW)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      title: "Budget 2026",
      url: BOOK.spreadsheetUrl,
      locale: "en_US",
      time_zone: "Europe/Paris",
      tabs: [
        {
          sheet_id: 0,
          title: "Plan",
          index: 0,
          hidden: false,
          row_count: 1000,
          column_count: 26,
          frozen_rows: 1,
          frozen_columns: 0,
          tables: [
            { table_id: "t-1", name: "Costs", range: "Plan!A1:C10" },
            { table_id: "t-2", name: "Wide", range: "Plan!Z3:AB8" },
          ],
        },
        {
          sheet_id: 77,
          title: "It's old",
          index: 1,
          hidden: true,
          row_count: 50,
          column_count: 5,
          frozen_rows: 0,
          frozen_columns: 2,
          tables: [{ table_id: "t-3", name: "Old", range: "'It''s old'!A1:B4" }],
        },
        {
          sheet_id: 5,
          title: "2026",
          index: 2,
          hidden: false,
          row_count: 0,
          column_count: 0,
          frozen_rows: 0,
          frozen_columns: 0,
          tables: [],
        },
      ],
    })
  })

  test("asks for the structure fields only, never cell data", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    await h.read(VIEW)

    expect(h.calls().map(callOf)).toEqual([`GET ${SPREADSHEET_URL}`])
    const { searchParams } = h.calls()[0]!.url
    expect(searchParams.get("fields")).toBe(
      "spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone)," +
        "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),tables(tableId,name,range))",
    )
    expect(searchParams.has("includeGridData")).toBe(false)
  })

  test("takes the spreadsheet's URL for its id", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    const result = await h.read({
      method: "view",
      spreadsheet: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=0`,
    })

    expect(result.spreadsheet_id).toBe(SPREADSHEET_ID)
    expect(h.calls().map(callOf)).toEqual([`GET ${SPREADSHEET_URL}`])
  })

  test("a spreadsheet with nothing to say gives empty values", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, {})])
    expect(await h.read(VIEW)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      title: "",
      url: null,
      locale: null,
      time_zone: null,
      tabs: [],
    })
  })

  test("a reply of another shape is upstream_error", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, { sheets: "none" })])
    await expect(h.read(VIEW)).rejects.toMatchObject({ code: "upstream_error" })
  })
})
