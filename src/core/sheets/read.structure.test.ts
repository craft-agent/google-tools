import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STRUCTURE = { method: "structure", spreadsheet: SPREADSHEET_ID }

const range = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
  sheetId: 0,
  startRowIndex,
  endRowIndex,
  startColumnIndex,
  endColumnIndex,
})

const PLAN = {
  properties: { title: "Plan" },
  merges: [range(0, 1, 0, 3), range(4, 6, 1, 2)],
  rowGroups: [
    { range: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 5 }, depth: 1, collapsed: true },
    { range: { sheetId: 0, dimension: "ROWS", startIndex: 3, endIndex: 4 }, depth: 2 },
  ],
  columnGroups: [{ range: { sheetId: 0, dimension: "COLUMNS", startIndex: 2, endIndex: 4 }, depth: 1 }],
  tables: [
    {
      tableId: "t-1",
      name: "Costs",
      range: { endRowIndex: 10, endColumnIndex: 3 },
      columnProperties: [
        { columnName: "Item", columnType: "TEXT" },
        { columnIndex: 1, columnName: "Cost", columnType: "CURRENCY" },
        {
          columnIndex: 2,
          columnName: "Status",
          columnType: "DROPDOWN",
          dataValidationRule: {
            condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "open" }, { userEnteredValue: "done" }] },
          },
        },
      ],
    },
  ],
  conditionalFormats: [
    {
      ranges: [range(1, 20, 2, 3), { sheetId: 0, startColumnIndex: 5, endColumnIndex: 6 }],
      booleanRule: {
        condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "5" }] },
        format: {
          textFormat: { bold: true, strikethrough: false, foregroundColorStyle: { rgbColor: { red: 1 } } },
          backgroundColorStyle: { rgbColor: { green: 1 } },
        },
      },
    },
    {
      ranges: [range(1, 20, 3, 4)],
      gradientRule: {
        minpoint: { colorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
        midpoint: {},
        maxpoint: { color: { red: 1 } },
      },
    },
    {
      ranges: [range(0, 1, 0, 1)],
      booleanRule: { condition: { type: "DATE_BEFORE", values: [{ relativeDate: "TODAY" }] } },
    },
    { ranges: [range(0, 1, 1, 2)], booleanRule: {} },
  ],
  basicFilter: {
    range: { sheetId: 0, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 6 },
    filterSpecs: [
      { columnIndex: 2, filterCriteria: { hiddenValues: ["a", "b"] } },
      {
        columnIndex: 3,
        filterCriteria: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "5" }] } },
      },
    ],
  },
  filterViews: [
    {
      filterViewId: 9001,
      title: "Open only",
      range: range(0, 30, 0, 6),
      filterSpecs: [
        {
          columnIndex: 0,
          filterCriteria: {
            hiddenValues: ["x"],
            condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "y" }] },
          },
        },
      ],
    },
  ],
  charts: [
    {
      chartId: 501,
      spec: { title: "Spend", basicChart: { chartType: "COLUMN" } },
      position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 11, columnIndex: 4 } } },
    },
    { chartId: 502, spec: { pieChart: { legendPosition: "RIGHT_LEGEND" } }, position: { overlayPosition: {} } },
    { chartId: 503, spec: { title: "Own tab", basicChart: { chartType: "LINE" } }, position: { sheetId: 8 } },
  ],
  protectedRanges: [
    {
      protectedRangeId: 7,
      range: range(0, 1, 0, 6),
      description: "Header",
      warningOnly: false,
      editors: { users: ["ann@example.test"] },
    },
    { protectedRangeId: 8, range: { sheetId: 0 }, warningOnly: true },
    { protectedRangeId: 9, range: range(2, 3, 0, 1), description: "Locked", editors: {} },
  ],
}

const BOOK = {
  properties: { title: "Budget 2026" },
  sheets: [
    PLAN,
    { properties: { sheetId: 77, title: "It's old", index: 1 } },
    { properties: { sheetId: 5, title: "2026", index: 2 } },
  ],
}

describe("google_sheets_read structure", () => {
  test("maps each tab's merges, groups, tables, rules, filters, charts and protections to A1 with the tab", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    const { structure } = await h.read(STRUCTURE)

    expect(structure).toHaveLength(3)
    expect(structure![0]).toEqual({
      sheet_id: 0,
      title: "Plan",
      merges: ["Plan!A1:C1", "Plan!B5:B6"],
      row_groups: [
        { range: "Plan!3:5", depth: 1, collapsed: true },
        { range: "Plan!4:4", depth: 2, collapsed: false },
      ],
      column_groups: [{ range: "Plan!C:D", depth: 1, collapsed: false }],
      tables: [
        {
          table_id: "t-1",
          name: "Costs",
          range: "Plan!A1:C10",
          columns: [
            { column: "A", name: "Item", type: "TEXT" },
            { column: "B", name: "Cost", type: "CURRENCY" },
            { column: "C", name: "Status", type: "DROPDOWN", options: ["open", "done"] },
          ],
          more_columns: 0,
        },
      ],
      conditional_rules: [
        {
          index: 0,
          ranges: ["Plan!C2:C20", "Plan!F:F"],
          kind: "boolean",
          condition: "NUMBER_GREATER 5",
          style: "bold, no strikethrough, color #ff0000, background #00ff00",
        },
        { index: 1, ranges: ["Plan!D2:D20"], kind: "gradient", style: "#ffffff > #ff0000" },
        { index: 2, ranges: ["Plan!A1"], kind: "boolean", condition: "DATE_BEFORE TODAY" },
        { index: 3, ranges: ["Plan!B1"], kind: "boolean", condition: "" },
      ],
      basic_filter: { range: "Plan!A1:F", criteria: ["C hide (a, b)", "D show NUMBER_GREATER 5"] },
      filter_views: [
        { view_id: 9001, title: "Open only", range: "Plan!A1:F30", criteria: ["A hide (x), show TEXT_CONTAINS y"] },
      ],
      charts: [
        { chart_id: 501, title: "Spend", type: "COLUMN", anchor: "Plan!E12", source: [] },
        { chart_id: 502, title: null, type: "PIE", anchor: "Plan!A1", source: [] },
        { chart_id: 503, title: "Own tab", type: "LINE", anchor: null, source: [] },
      ],
      pivots: null,
      protections: [
        {
          protection_id: 7,
          range: "Plan!A1:F1",
          description: "Header",
          warning_only: false,
          editors: ["ann@example.test"],
        },
        { protection_id: 8, range: "Plan", description: null, warning_only: true, editors: null },
        { protection_id: 9, range: "Plan!A3", description: "Locked", warning_only: false, editors: [] },
      ],
      more: {
        merges: 0,
        row_groups: 0,
        column_groups: 0,
        tables: 0,
        conditional_rules: 0,
        filter_views: 0,
        charts: 0,
        pivots: 0,
        protections: 0,
      },
    })
  })

  test("gives a tab with nothing special empty lists and no filter, with the id and title Google reports", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    const { structure } = await h.read(STRUCTURE)

    expect(structure![1]).toEqual({
      sheet_id: 77,
      title: "It's old",
      merges: [],
      row_groups: [],
      column_groups: [],
      tables: [],
      conditional_rules: [],
      basic_filter: null,
      filter_views: [],
      charts: [],
      pivots: null,
      protections: [],
      more: expect.objectContaining({ merges: 0 }),
    })
  })

  test("reads the spreadsheet once, with a field mask and no grid data, and holds no cell values", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    const result = await h.read(STRUCTURE)

    expect(h.calls()).toHaveLength(1)
    const fields = h.calls()[0]!.url.searchParams.get("fields")!
    expect(fields).toStartWith("sheets(properties(sheetId,title,index),merges,")
    expect(fields).toContain("protectedRanges(protectedRangeId,range,description,warningOnly,editors(users))")
    expect(fields).toContain("domains(domain(sourceRange))")
    expect(fields).not.toContain("data(")
    expect(h.calls()[0]!.url.searchParams.has("includeGridData")).toBe(false)
    expect(result.spreadsheet_id).toBe(SPREADSHEET_ID)
  })

  test("reads the tabs asked for by title, left to right, exactly or ignoring case, and each once", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    const { structure } = await h.read({ ...STRUCTURE, tabs: ["2026", "PLAN", "plan"] })

    expect(structure!.map((tab) => tab.title)).toEqual(["Plan", "2026"])
  })

  test("refuses a tab the spreadsheet lacks, naming its tabs", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, BOOK)])

    await expect(h.read({ ...STRUCTURE, tabs: ["Nope"] })).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Plan, It's old, 2026"),
    })
  })

  test.each([
    ["an argument it does not take", { ...STRUCTURE, ranges: ["A1"] }, "takes no `ranges`"],
    ["pivots on another method", { method: "view", spreadsheet: SPREADSHEET_ID, pivots: true }, "takes no `pivots`"],
    ["tabs on another method", { method: "view", spreadsheet: SPREADSHEET_ID, tabs: ["Plan"] }, "takes no `tabs`"],
    ["no spreadsheet", { method: "structure" }, "needs `spreadsheet`"],
  ])("refuses %s before any request", async (_name, args, message) => {
    const h = await fixture()

    await expect(h.read(args)).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining(message),
    })
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_read structure: the lists are capped", () => {
  const many = (count: number) => Array.from({ length: count }, (_, row) => range(row, row + 1, 0, 2))

  test("lists the first 50 of each and counts the rest in `more`", async () => {
    const sheet = {
      properties: { title: "Big" },
      merges: many(120),
      tables: Array.from({ length: 51 }, (_, index) => ({
        tableId: `t${index}`,
        name: `T${index}`,
        range: range(0, 1, 0, 1),
      })),
      conditionalFormats: many(60).map((block) => ({ ranges: [block], gradientRule: {} })),
      filterViews: Array.from({ length: 70 }, (_, index) => ({
        filterViewId: index,
        title: `V${index}`,
        range: range(0, 1, 0, 1),
      })),
      charts: Array.from({ length: 52 }, (_, index) => ({ chartId: index, spec: {}, position: {} })),
      protectedRanges: Array.from({ length: 50 }, (_, index) => ({
        protectedRangeId: index,
        range: range(0, 1, 0, 1),
      })),
      rowGroups: Array.from({ length: 55 }, (_, index) => ({
        range: { startIndex: index, endIndex: index + 1 },
        depth: 1,
      })),
      columnGroups: [{ range: { startIndex: 0, endIndex: 1 }, depth: 1 }],
    }
    const h = await fixture([answer(SPREADSHEET_URL, { sheets: [sheet] })])

    const [tab] = (await h.read(STRUCTURE)).structure!

    expect(tab!.merges).toHaveLength(50)
    expect(tab!.merges.at(-1)).toBe("Big!A50:B50")
    expect(tab!.tables).toHaveLength(50)
    expect(tab!.conditional_rules.map((rule) => rule.index)).toEqual(Array.from({ length: 50 }, (_, index) => index))
    expect(tab!.filter_views).toHaveLength(50)
    expect(tab!.charts).toHaveLength(50)
    expect(tab!.protections).toHaveLength(50)
    expect(tab!.row_groups).toHaveLength(50)
    expect(tab!.column_groups).toHaveLength(1)
    expect(tab!.more).toEqual({
      merges: 70,
      row_groups: 5,
      column_groups: 0,
      tables: 1,
      conditional_rules: 10,
      filter_views: 20,
      charts: 2,
      pivots: 0,
      protections: 0,
    })
  })

  test("lists the first 50 columns of a table and counts the rest, and the first 50 criteria of a filter with the count of the rest as the last entry", async () => {
    const sheet = {
      properties: { title: "Wide" },
      tables: [
        {
          tableId: "t",
          name: "T",
          range: range(0, 5, 1, 60),
          columnProperties: Array.from({ length: 53 }, (_, index) => ({ columnIndex: index, columnName: `C${index}` })),
        },
      ],
      basicFilter: {
        range: range(0, 5, 0, 60),
        filterSpecs: Array.from({ length: 52 }, (_, index) => ({
          columnIndex: index,
          filterCriteria: { hiddenValues: ["v"] },
        })),
      },
    }
    const h = await fixture([answer(SPREADSHEET_URL, { sheets: [sheet] })])

    const [tab] = (await h.read(STRUCTURE)).structure!

    expect(tab!.tables[0]!.columns).toHaveLength(50)
    expect(tab!.tables[0]!.columns[49]).toEqual({ column: "AY", name: "C49", type: "TEXT" })
    expect(tab!.tables[0]!.more_columns).toBe(3)
    expect(tab!.basic_filter!.criteria).toHaveLength(51)
    expect(tab!.basic_filter!.criteria.at(-1)).toBe("+2 more")
  })
})
