import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { FakeHandler } from "../google/fake-google.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STRUCTURE = { method: "structure", spreadsheet: SPREADSHEET_ID }

/** The data of one column of the tab with the id `sheetId` (0 when Google leaves it out), from the first row to `endRowIndex`. */
const column = (index: number, endRowIndex: number, sheetId?: number) => ({
  sourceRange: {
    sources: [
      {
        ...(sheetId !== undefined && { sheetId }),
        startRowIndex: 0,
        endRowIndex,
        startColumnIndex: index,
        endColumnIndex: index + 1,
      },
    ],
  },
})

const PIVOT = {
  source: { sheetId: 77, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 5 },
  rows: [{ sourceColumnOffset: 0 }, { sourceColumnOffset: 1, groupRule: { dateTimeRule: { type: "YEAR_MONTH" } } }],
  columns: [{ sourceColumnOffset: 2 }],
  values: [
    { sourceColumnOffset: 3, summarizeFunction: "AVERAGE" },
    { formula: "=SUM(Amount)", summarizeFunction: "CUSTOM", name: "Total" },
  ],
}

/** What the read of the structure answers: three tabs, the first with charts. */
const BOOK = {
  sheets: [
    {
      properties: { title: "Plan" },
      charts: [
        {
          chartId: 501,
          spec: {
            title: "Spend",
            basicChart: {
              chartType: "COLUMN",
              domains: [{ domain: column(0, 13) }],
              series: [{ series: column(1, 13) }, { series: column(2, 13) }, { series: column(1, 13) }],
            },
          },
          position: { overlayPosition: { anchorCell: { rowIndex: 11, columnIndex: 4 } } },
        },
        {
          chartId: 502,
          spec: { pieChart: { legendPosition: "RIGHT_LEGEND", domain: column(0, 13, 77), series: column(1, 13, 77) } },
          position: { overlayPosition: {} },
        },
        { chartId: 503, spec: { basicChart: { chartType: "LINE" } }, position: { sheetId: 8 } },
      ],
    },
    { properties: { sheetId: 77, title: "My Tab", index: 1 } },
    { properties: { sheetId: 5, title: "a/b", index: 2 } },
  ],
}

/** What the read of the cells answers: the pivot tables of the first two tabs. */
const CELLS = {
  sheets: [
    { properties: {}, data: [{ rowData: [{ values: [{}, {}] }, {}, { values: [{}, { pivotTable: PIVOT }] }] }] },
    {
      properties: { sheetId: 77 },
      data: [
        {
          startRow: 4,
          startColumn: 2,
          rowData: [
            {
              values: [{ pivotTable: { source: { endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 1 } } }, {}],
            },
          ],
        },
      ],
    },
    { properties: { sheetId: 5 }, data: [{}] },
  ],
}

/** The reads of the spreadsheet: the cells (`includeGridData`) answer `cells`, the structure `book`. */
const reads = (cells: unknown = CELLS, book: unknown = BOOK): FakeHandler => ({
  method: "GET",
  url: SPREADSHEET_URL,
  reply: ({ url }) => ({ json: url.searchParams.has("includeGridData") ? cells : book }),
})

describe("google_sheets_read structure: the ranges charts draw from", () => {
  test("lists them each once, with the tab they are on", async () => {
    const h = await fixture([reads()])

    const { structure } = await h.read(STRUCTURE)

    expect(structure![0]!.charts.map((chart) => chart.source)).toEqual([
      ["Plan!A1:A13", "Plan!B1:B13", "Plan!C1:C13"],
      ["'My Tab'!A1:A13", "'My Tab'!B1:B13"],
      [],
    ])
  })
})

describe("google_sheets_read structure: pivot tables", () => {
  test("leaves `pivots` null and sends no second read when they are not asked for", async () => {
    const h = await fixture([reads()])

    const { structure } = await h.read(STRUCTURE)
    const asked = await h.read({ ...STRUCTURE, pivots: false })

    expect(structure!.map((tab) => tab.pivots)).toEqual([null, null, null])
    expect(structure!.map((tab) => tab.more.pivots)).toEqual([0, 0, 0])
    expect(asked.structure!.map((tab) => tab.pivots)).toEqual([null, null, null])
    expect(h.calls()).toHaveLength(2)
    expect(h.calls().some((call) => call.url.searchParams.has("includeGridData"))).toBe(false)
  })

  test("reads the cells of the tabs read in a second request that asks for the pivot tables only", async () => {
    const h = await fixture([reads()])

    await h.read({ ...STRUCTURE, pivots: true })

    expect(h.calls()).toHaveLength(2)
    const [first, second] = h.calls()
    expect(first!.url.searchParams.has("includeGridData")).toBe(false)
    expect(second!.url.searchParams.get("includeGridData")).toBe("true")
    expect(second!.url.searchParams.getAll("ranges")).toEqual(["Plan", "'My Tab'", "'a/b'"])
    const fields = second!.url.searchParams.get("fields")!
    expect(fields).toContain("pivotTable(source,")
    expect(fields).not.toContain("Value")
  })

  test("limits the second read to the tabs asked for", async () => {
    const h = await fixture([reads()])

    const { structure } = await h.read({ ...STRUCTURE, tabs: ["my tab"], pivots: true })

    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["'My Tab'"])
    expect(structure!.map((tab) => tab.title)).toEqual(["My Tab"])
  })

  test("lists each pivot table with its anchor, its source and what its rows, columns and values are made of", async () => {
    const h = await fixture([reads()])

    const { structure } = await h.read({ ...STRUCTURE, pivots: true })

    expect(structure![0]!.pivots).toEqual([
      {
        at: "Plan!B3",
        source: "'My Tab'!B1:E10",
        rows: ["B", "C by YEAR_MONTH"],
        columns: ["D"],
        values: ["AVERAGE of E", 'CUSTOM =SUM(Amount) as "Total"'],
      },
    ])
    expect(structure![1]!.pivots).toEqual([
      { at: "'My Tab'!C5", source: "Plan!A1:A5", rows: [], columns: [], values: [] },
    ])
    expect(structure![2]!.pivots).toEqual([])
    expect(structure![0]!.more.pivots).toBe(0)
  })

  test("lists the first 50 pivot tables of a tab and counts the rest in `more`", async () => {
    const rowData = Array.from({ length: 52 }, () => ({ values: [{ pivotTable: {} }] }))
    const book = { sheets: [{ properties: { title: "Big" } }] }
    const cells = { sheets: [{ properties: {}, data: [{ rowData }] }] }
    const h = await fixture([reads(cells, book)])

    const [tab] = (await h.read({ ...STRUCTURE, pivots: true })).structure!

    expect(tab!.pivots).toHaveLength(50)
    expect(tab!.pivots!.at(-1)).toEqual({ at: "Big!A50", source: "Big", rows: [], columns: [], values: [] })
    expect(tab!.more.pivots).toBe(2)
  })

  test("lists none for a tab Google gives no cell data for", async () => {
    const h = await fixture([reads({ sheets: [] })])

    const { structure } = await h.read({ ...STRUCTURE, pivots: true })

    expect(structure!.map((tab) => tab.pivots)).toEqual([[], [], []])
  })
})
