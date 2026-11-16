import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS, refusedCall, sendAdd } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const red = { rgbColor: { red: 1, green: 0, blue: 0 } }

describe("google_sheets_add: table", () => {
  test("makes a table of a closed block with its columns and colors, and lists the table as Google answered", async () => {
    const { body, result } = await sendAdd(
      [
        {
          op: "table",
          range: "Plan!A10:D20",
          name: "Stock",
          table_columns: [
            { column: "a", name: "Item", type: "TEXT" },
            { column: "C", type: "DROPDOWN", values: ["low", 5, true] },
          ],
          header_color: "#ff0000",
          band_colors: ["#ffffff", "theme:ACCENT1"],
          footer_color: "#000",
        },
      ],
      {
        spreadsheet: WITH_OBJECTS,
        reply: {
          replies: [{ addTable: { table: { tableId: "tbl-new", name: "Stock", range: PLAN_GRID(9, 20, 0, 4) } } }],
        },
      },
    )

    expect(body.requests).toEqual([
      {
        addTable: {
          table: {
            name: "Stock",
            range: PLAN_GRID(9, 20, 0, 4),
            columnProperties: [
              { columnIndex: 0, columnName: "Item", columnType: "TEXT" },
              {
                columnIndex: 2,
                columnType: "DROPDOWN",
                dataValidationRule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: [{ userEnteredValue: "low" }, { userEnteredValue: "5" }, { userEnteredValue: "TRUE" }],
                  },
                },
              },
            ],
            rowsProperties: {
              headerColorStyle: red,
              footerColorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } },
              firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
              secondBandColorStyle: { themeColor: "ACCENT1" },
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual([
      'table "Stock" on Plan!A10:D20: A "Item" TEXT, C dropdown (low, 5, TRUE), header #ff0000, footer #000000, bands #ffffff/theme:ACCENT1',
    ])
    expect(result.tables).toEqual([{ table_id: "tbl-new", name: "Stock", range: "Plan!A10:D20" }])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("names a table Table plus the first number no table has, and sends no column properties for none", async () => {
    const { body } = await sendAdd(
      [
        { op: "table", range: "Plan!A10:B12" },
        { op: "table", range: "'My Tab'!A1:B3" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      { addTable: { table: { name: "Table3", range: PLAN_GRID(9, 12, 0, 2) } } },
      { addTable: { table: { name: "Table4", range: { ...PLAN_GRID(0, 3, 0, 2), sheetId: 77 } } } },
    ])
  })

  test("keeps the header text of a column that is not named as its name, reading the header row once", async () => {
    const { h, body } = await sendAdd(
      [
        {
          op: "table",
          range: "Plan!A10:C20",
          table_columns: [
            { column: "B", type: "DOUBLE" },
            { column: "C", type: "TEXT", name: "Own" },
          ],
        },
      ],
      { spreadsheet: WITH_OBJECTS, rows: () => [["Item", " Qty ", "Note"]] },
    )

    expect(body.requests).toEqual([
      {
        addTable: {
          table: {
            name: "Table3",
            range: PLAN_GRID(9, 20, 0, 3),
            columnProperties: [
              { columnIndex: 1, columnName: "Qty", columnType: "DOUBLE" },
              { columnIndex: 2, columnName: "Own", columnType: "TEXT" },
            ],
          },
        },
      },
    ])
    const reads = h.calls().filter((call) => call.url.pathname.endsWith("/values:batchGet"))
    expect(reads.map((call) => call.url.searchParams.getAll("ranges"))).toEqual([["Plan!A10:C10"]])
    expect(reads[0]!.url.searchParams.get("valueRenderOption")).toBe("FORMATTED_VALUE")
  })

  test("reads no header when every column it types is named", async () => {
    const { h } = await sendAdd(
      [{ op: "table", range: "Plan!A10:C20", table_columns: [{ column: "B", type: "DOUBLE", name: "Qty" }] }],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(h.calls().some((call) => call.url.pathname.endsWith("/values:batchGet"))).toBe(false)
  })

  test.each([
    ["a range that overlaps a table", { range: "Plan!C4:E8" }, 'overlaps the table "Orders" (Plan!A1:C5)'],
    ["a range inside a table", { range: "Plan!B2:B3" }, 'overlaps the table "Orders"'],
    ["a range of whole columns", { range: "Plan!G:H" }, "closed block"],
    ["a range with an open end", { range: "Plan!A10:C" }, "closed block"],
    [
      "a column outside the range",
      { range: "Plan!A10:C20", table_columns: [{ column: "D", type: "TEXT" }] },
      "Column D",
    ],
    [
      "a dropdown's options on another type",
      { range: "Plan!A10:C20", table_columns: [{ column: "A", type: "TEXT", values: ["a"] }] },
      "need type DROPDOWN",
    ],
    [
      "a column with neither type nor name",
      { range: "Plan!A10:C20", table_columns: [{ column: "A" }] },
      "`type` or a `name`",
    ],
    ["three band colors", { range: "Plan!A10:C20", band_colors: ["#fff", "#eee", "#ddd"] }, "band_colors"],
    ["a range of a tab the spreadsheet lacks", { range: "Nope!A1:B2" }, "names no tab"],
  ])("refuses %s, and sends nothing", async (_name, op, message) => {
    const error = await refusedCall("add", [{ op: "table", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("refuses a range that overlaps a table an earlier operation of the call makes", async () => {
    const error = await refusedCall("add", [
      { op: "table", range: "Plan!A10:C20" },
      { op: "table", range: "Plan!B15:D25" },
    ])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('overlaps the table "Table3"')
  })

  test("takes a block next to a table", async () => {
    const { body } = await sendAdd([{ op: "table", range: "Plan!D1:D5" }], { spreadsheet: WITH_OBJECTS })

    expect(body.requests).toHaveLength(1)
  })
})
