import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PIVOT_CELL, VALUE_CELL, WITH_CHARTS } from "./charts.testing"
import { cleanUp, freshTokens } from "./read.testing"
import { refusedCall, sendAdd, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SOURCE = { startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 4 }

const pivot = (operation: object) => ({
  op: "pivot",
  range: "Plan!A1:D100",
  pivot_values: [{ column: "D" }],
  ...operation,
})

/** `WITH_CHARTS` with `Plan` of `rows` rows, so that the area below a cell is larger than a read allows. */
const tallPlan = (rows: number) => ({
  ...WITH_CHARTS,
  sheets: WITH_CHARTS.sheets.map((sheet) =>
    sheet.properties.title === "Plan"
      ? { ...sheet, properties: { ...sheet.properties, gridProperties: { rowCount: rows, columnCount: 10 } } }
      : sheet,
  ),
})

describe("google_sheets_add: pivot", () => {
  test("writes a pivot table of the source at a cell of an empty area, with each column counted from the source's first", async () => {
    const { body, result, h } = await sendAdd(
      [
        pivot({
          range: "'My Tab'!B1:E10",
          pivot_rows: ["B", { column: "C", group: "YEAR_MONTH", sort: "desc", label: "Month", totals: false }],
          pivot_columns: ["D"],
          pivot_values: [
            { column: "E", summarize: "AVERAGE" },
            { formula: "=SUM(Amount)", name: "Total" },
          ],
          pivot_filters: [{ column: "D", show: ["x", 2] }],
          at: "Plan!F2",
        }),
      ],
      { spreadsheet: WITH_CHARTS },
    )

    expect(body.requests).toEqual([
      {
        updateCells: {
          start: { sheetId: 0, rowIndex: 1, columnIndex: 5 },
          fields: "pivotTable",
          rows: [
            {
              values: [
                {
                  pivotTable: {
                    source: { sheetId: 77, startRowIndex: 0, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 5 },
                    valueLayout: "HORIZONTAL",
                    rows: [
                      { sourceColumnOffset: 0, showTotals: true, sortOrder: "ASCENDING" },
                      {
                        sourceColumnOffset: 1,
                        showTotals: false,
                        sortOrder: "DESCENDING",
                        groupRule: { dateTimeRule: { type: "YEAR_MONTH" } },
                        label: "Month",
                      },
                    ],
                    columns: [{ sourceColumnOffset: 2, showTotals: true, sortOrder: "ASCENDING" }],
                    values: [
                      { sourceColumnOffset: 3, summarizeFunction: "AVERAGE" },
                      { formula: "=SUM(Amount)", summarizeFunction: "CUSTOM", name: "Total" },
                    ],
                    filterSpecs: [{ columnOffsetIndex: 2, filterCriteria: { visibleValues: ["x", "2"] } }],
                  },
                },
              ],
            },
          ],
        },
      },
    ])
    expect(result.applied).toEqual([
      "pivot of 'My Tab'!B1:E10 at Plan!F2, overwriting the cells it fills: rows B, C by year month descending; columns D; values AVERAGE of E, CUSTOM =SUM(Amount) as \"Total\"; only D in (x, 2)",
    ])
    expect(result.tabs).toEqual(["Plan", "My Tab"])
    const read = h.calls().find((call) => call.url.searchParams.has("includeGridData"))!
    expect(read.url.searchParams.getAll("ranges")).toEqual(["Plan!F2:J100"])
  })

  test("puts the pivot table on a new tab, with a title or the first free `Pivot table N`, and lists the tab Google made", async () => {
    const reply = { replies: [{ addSheet: { properties: { sheetId: 78, title: "Report", index: 3 } } }, {}, {}, {}] }
    const { body, result, h } = await sendAdd(
      [
        pivot({ new_tab: true, title: "Report" }),
        pivot({ new_tab: true }),
        pivot({ range: "Plan!A1:D100", new_tab: true, pivot_rows: ["A"] }),
      ],
      { spreadsheet: WITH_CHARTS, reply },
    )

    const requests = body.requests as any[]
    expect(requests.map((request) => Object.keys(request)[0])).toEqual([
      "addSheet",
      "updateCells",
      "addSheet",
      "updateCells",
      "addSheet",
      "updateCells",
    ])
    expect(requests.filter((request) => request.addSheet).map((request) => request.addSheet.properties)).toEqual([
      { sheetId: 78, title: "Report" },
      { sheetId: 79, title: "Pivot table 1" },
      { sheetId: 80, title: "Pivot table 2" },
    ])
    expect(requests[3].updateCells.start).toEqual({ sheetId: 79, rowIndex: 0, columnIndex: 0 })
    expect(requests[1].updateCells.rows[0].values[0].pivotTable.source).toEqual({ sheetId: 0, ...SOURCE })
    expect(result.applied[0]).toBe('pivot of Plan!A1:D100 on a new tab "Report": values SUM of D')
    expect(result.created).toEqual([{ sheet_id: 78, title: "Report", index: 3 }, expect.anything(), expect.anything()])
    expect(h.calls().some((call) => call.url.searchParams.has("includeGridData"))).toBe(false)
  })

  test("checks the cells from the cell to the tab's last row and column, on the tab of the source when `at` names none", async () => {
    const { h } = await sendAdd([pivot({ at: "H3" })], { spreadsheet: WITH_CHARTS })

    const read = h.calls().find((call) => call.url.searchParams.has("includeGridData"))!
    expect(read.url.searchParams.getAll("ranges")).toEqual(["Plan!H3:J100"])
    expect(read.url.searchParams.get("fields")).toContain("effectiveValue")
    expect(read.url.searchParams.get("fields")).toContain("pivotTable")
  })

  test.each([
    ["a value", VALUE_CELL],
    ["a pivot table", PIVOT_CELL],
  ])("refuses a pivot table over a cell that holds %s, and sends nothing", async (_name, validation) => {
    const error = await refusedCall("add", [pivot({ at: "Plan!F2" })], { spreadsheet: WITH_CHARTS, validation })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("would overwrite them")
    expect(error.message).toContain("place it on a new tab or an empty area")
  })

  test("refuses an area of more than 10,000 cells as too large to check, before it reads them", async () => {
    const error = await refusedCall("add", [pivot({ at: "Plan!A1" })], {
      spreadsheet: tallPlan(1_001),
      validation: VALUE_CELL,
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("too large to check")
  })

  test.each([
    ["a column outside the source", { pivot_rows: ["F"], at: "Plan!F2" }, "pivot_rows column F is outside"],
    [
      "a value column outside the source",
      { pivot_values: [{ column: "A" }], range: "Plan!B1:D9", at: "H1" },
      "pivot_values column A",
    ],
    ["a source of whole rows", { range: "Plan!3:5", at: "Plan!F2" }, "block or whole columns"],
    ["neither `at` nor `new_tab`", {}, "Give `at` or `new_tab`"],
    ["`at` and `new_tab`", { at: "Plan!F2", new_tab: true }, "Give `at` or `new_tab`"],
    ["a title with `at`", { at: "Plan!F2", title: "X" }, "goes with `new_tab`"],
    ["an anchor of more than one cell", { at: "Plan!F2:G3" }, "`at` is one cell"],
    ["a tab title that is taken, ignoring case", { new_tab: true, title: "my tab" }, "already has a tab"],
    ["no value", { at: "Plan!F2", pivot_values: [] }, "pivot_values"],
    ["a formula without its =", { at: "Plan!F2", pivot_values: [{ formula: "SUM(Amount)" }] }, "pivot_values"],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refusedCall("add", [pivot(operation)], { spreadsheet: WITH_CHARTS })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_restructure: pivot_delete", () => {
  const rows = () => [
    ["Region", "Total"],
    ["East", 5],
  ]

  test("clears the pivot table at the cell, and returns the cells from there to the tab's end as `before`", async () => {
    const { body, result } = await sendRestructure([{ op: "pivot_delete", at: "Plan!B2" }], {
      spreadsheet: WITH_CHARTS,
      validation: PIVOT_CELL,
      rows,
    })

    expect(body.requests).toEqual([
      {
        updateCells: {
          range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
          fields: "pivotTable",
          rows: [{ values: [{}] }],
        },
      },
    ])
    expect(result.applied).toEqual([
      "pivot_delete Plan!B2 with its output, which is the cells from there to the end of its tab",
    ])
    expect(result.before).toEqual([
      {
        range: "Plan!B2:J100",
        values: [
          ["Region", "Total"],
          ["East", 5],
        ],
      },
    ])
    expect(result.before_truncated).toBe(false)
    expect(result.tabs).toEqual(["Plan"])
  })

  test("takes a cell with a tab, and with none the first tab", async () => {
    const other = await sendRestructure([{ op: "pivot_delete", at: "'My Tab'!C3" }], {
      spreadsheet: WITH_CHARTS,
      validation: PIVOT_CELL,
      rows,
    })
    expect(other.result.before[0].range).toBe("'My Tab'!C3:E50")
    expect(other.result.tabs).toEqual(["My Tab"])

    const first = await sendRestructure([{ op: "pivot_delete", at: "A1" }], {
      spreadsheet: WITH_CHARTS,
      validation: PIVOT_CELL,
      rows,
    })
    expect(first.result.before[0].range).toBe("Plan!A1:J100")
  })

  test.each([
    ["a cell that holds no pivot table", { at: "Plan!B2" }, "No pivot table is anchored at Plan!B2"],
    ["a range of more than one cell", { at: "Plan!B2:C3" }, "`at` is one cell"],
    ["a tab the spreadsheet lacks", { at: "Nope!B2" }, "names no tab"],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refusedCall("restructure", [{ op: "pivot_delete", ...operation }], {
      spreadsheet: WITH_CHARTS,
      validation: {},
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})
