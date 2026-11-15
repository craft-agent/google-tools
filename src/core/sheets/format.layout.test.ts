import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN, send } from "./format.testing"
import { SPREADSHEET } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)
describe("google_sheets_format: rows and columns", () => {
  test("sizes whole rows or columns in pixels, or fits them to their contents", async () => {
    const { body } = await send([
      { op: "size", range: "Plan!B:C", pixels: 120 },
      { op: "size", ranges: ["Plan!3", "'My Tab'!A:A"], auto: true },
    ])

    const columns = { sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 3 }
    expect(body.requests).toEqual([
      { updateDimensionProperties: { range: columns, properties: { pixelSize: 120 }, fields: "pixelSize" } },
      { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 3 } } },
      { autoResizeDimensions: { dimensions: { sheetId: 77, dimension: "COLUMNS", startIndex: 0, endIndex: 1 } } },
    ])
  })

  test("hides and shows whole rows or columns", async () => {
    const { body } = await send([
      { op: "hide", range: "Plan!2:3" },
      { op: "unhide", range: "Plan!D:D" },
    ])

    expect(body.requests).toEqual([
      {
        updateDimensionProperties: {
          range: { sheetId: 0, dimension: "ROWS", startIndex: 1, endIndex: 3 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: 0, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
          properties: { hiddenByUser: false },
          fields: "hiddenByUser",
        },
      },
    ])
  })

  test("groups rows, collapsing at the depth the existing groups give, and ungroups the innermost", async () => {
    const rows = { sheetId: 0, dimension: "ROWS" }
    const withGroups = {
      ...SPREADSHEET,
      sheets: [
        { ...SPREADSHEET.sheets[2]!, rowGroups: [{ range: { ...rows, startIndex: 0, endIndex: 10 }, depth: 1 }] },
        ...SPREADSHEET.sheets.slice(0, 2),
      ],
    }
    const { body } = await send(
      [
        { op: "group", range: "Plan!2:4", collapsed: true },
        { op: "group", range: "Plan!3:4" },
        { op: "ungroup", range: "Plan!2:4" },
      ],
      withGroups,
    )

    const inner = { ...rows, startIndex: 1, endIndex: 4 }
    expect(body.requests).toEqual([
      { addDimensionGroup: { range: inner } },
      { updateDimensionGroup: { dimensionGroup: { range: inner, depth: 2, collapsed: true }, fields: "collapsed" } },
      { addDimensionGroup: { range: { ...rows, startIndex: 2, endIndex: 4 } } },
      { deleteDimensionGroup: { range: inner } },
    ])
  })

  test("reads the existing groups only for a call that groups", async () => {
    const hide = await send([{ op: "hide", range: "Plan!2" }])
    const group = await send([{ op: "group", range: "Plan!2" }])

    expect(hide.h.calls().filter((call) => call.method === "GET")).toHaveLength(1)
    expect(group.h.calls().filter((call) => call.method === "GET")).toHaveLength(2)
    expect(group.h.calls()[1]!.url.searchParams.get("fields")).toBe("sheets(rowGroups(range),columnGroups(range))")
  })

  test("unmerges the cells of each range", async () => {
    const { body } = await send([{ op: "unmerge", ranges: ["Plan!A1:B2", "a/b"] }])

    expect(body.requests).toEqual([
      {
        unmergeCells: {
          range: PLAN({ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 2 }),
        },
      },
      { unmergeCells: { range: { sheetId: 5 } } },
    ])
  })
})

describe("google_sheets_format: tabs", () => {
  test("freezes the rows and columns given, on the first tab or the tab named, and 0 unfreezes", async () => {
    const { body } = await send([
      { op: "freeze", rows: 1 },
      { op: "freeze", tab: "my tab", rows: 0, columns: 2 },
    ])

    expect(body.requests).toEqual([
      {
        updateSheetProperties: {
          properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId: 77, gridProperties: { frozenRowCount: 0, frozenColumnCount: 2 } },
          fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
        },
      },
    ])
  })

  test("sets a tab's color, visibility and gridlines with a mask of what is given", async () => {
    const { body } = await send([
      { op: "tab", tab: "My Tab", color: "#112233", hidden: true, gridlines: false },
      { op: "tab", tab: "Plan", color: null },
    ])

    expect(body.requests).toEqual([
      {
        updateSheetProperties: {
          properties: {
            sheetId: 77,
            tabColorStyle: { rgbColor: { red: 0x11 / 255, green: 0x22 / 255, blue: 0x33 / 255 } },
            hidden: true,
            gridProperties: { hideGridlines: true },
          },
          fields: "tabColor,tabColorStyle,hidden,gridProperties.hideGridlines",
        },
      },
      { updateSheetProperties: { properties: { sheetId: 0 }, fields: "tabColor,tabColorStyle" } },
    ])
  })

  test("moves a tab to a position counted after the earlier moves of the call", async () => {
    const { body } = await send([
      { op: "tab", tab: "Plan", position: 1 },
      { op: "tab", tab: "a/b", position: 0 },
      { op: "tab", tab: "My Tab", position: 99 },
    ])

    // Order: Plan, My Tab, a/b → My Tab, Plan, a/b → a/b, My Tab, Plan → a/b, Plan, My Tab.
    expect(body.requests.map((request: any) => request.updateSheetProperties.properties.index)).toEqual([2, 0, 3])
  })
})
