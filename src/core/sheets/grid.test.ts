import { describe, expect, test } from "bun:test"
import { dimensionOf, dimensionRange, gridRange, resolveRange } from "./grid"
import type { SheetTab } from "./tabs"

const tab = (sheetId: number, title: string, index: number): SheetTab => ({
  sheetId,
  title,
  index,
  hidden: false,
  tables: [],
})

const TABS = [tab(0, "Plan", 0), tab(77, "My Tab", 1), tab(5, "a/b", 2)]

describe("gridRange", () => {
  test.each([
    ["B2:D9", { startRowIndex: 1, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 4 }],
    ["A1", { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }],
    ["AA10:AB11", { startRowIndex: 9, endRowIndex: 11, startColumnIndex: 26, endColumnIndex: 28 }],
    ["$B$2:$D$9", { startRowIndex: 1, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 4 }],
    ["d9:b2", { startRowIndex: 1, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 4 }],
    ["A2:C", { startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }],
    ["A:C", { startColumnIndex: 0, endColumnIndex: 3 }],
    ["B:B", { startColumnIndex: 1, endColumnIndex: 2 }],
    ["3:5", { startRowIndex: 2, endRowIndex: 5 }],
    ["5:3", { startRowIndex: 2, endRowIndex: 5 }],
    ["Plan!7", { startRowIndex: 6, endRowIndex: 7 }],
    ["Plan!C", { startColumnIndex: 2, endColumnIndex: 3 }],
  ])("reads %p", (cells, bounds) => {
    expect(gridRange(TABS, cells)).toEqual({ sheetId: 0, ...bounds })
  })

  test("takes the tab the range names, quoted or not, ignoring case when one tab fits; the first tab otherwise", () => {
    expect(gridRange(TABS, "'My Tab'!A1:B2").sheetId).toBe(77)
    expect(gridRange(TABS, "my tab!A:A").sheetId).toBe(77)
    expect(gridRange(TABS, "'a/b'!1:2").sheetId).toBe(5)
    expect(gridRange(TABS, "B2").sheetId).toBe(0)
  })

  test("a tab's name alone is the whole tab", () => {
    expect(gridRange(TABS, "'My Tab'")).toEqual({ sheetId: 77 })
    expect(gridRange(TABS, "Plan")).toEqual({ sheetId: 0 })
  })

  test("resolves the tab beside the grid", () => {
    expect(resolveRange(TABS, "'My Tab'!A1")).toEqual({
      tab: TABS[1]!,
      grid: { sheetId: 77, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
    })
  })

  test.each([
    "Plan!A1:",
    "Plan!A0",
    "Plan!A:3",
    "Plan!A1:B0",
    "Plan!AAAA1",
    "Plan!1A",
    "Plan!:",
    "Plan!A-1",
    "'Plan!A1",
  ])("refuses %p as invalid_argument", (range) => {
    expect(() => gridRange(TABS, range)).toThrow(expect.objectContaining({ code: "invalid_argument" }))
  })

  test("refuses a tab the spreadsheet lacks, naming the tabs", () => {
    expect(() => gridRange(TABS, "Nope!A1")).toThrow(/Plan, My Tab, a\/b/)
  })
})

describe("dimensionRange", () => {
  test("whole rows are ROWS, whole columns COLUMNS, zero-based and end-exclusive", () => {
    expect(dimensionRange(TABS, "3:5")).toEqual({ sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 5 })
    expect(dimensionRange(TABS, "'My Tab'!4")).toEqual({ sheetId: 77, dimension: "ROWS", startIndex: 3, endIndex: 4 })
    expect(dimensionRange(TABS, "B:D")).toEqual({ sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 4 })
    expect(dimensionRange(TABS, "'a/b'!AA:AA")).toEqual({
      sheetId: 5,
      dimension: "COLUMNS",
      startIndex: 26,
      endIndex: 27,
    })
  })

  test.each(["A1:C3", "A2:C", "A1", "Plan", "'My Tab'"])("refuses %p, which is not whole rows or columns", (range) => {
    expect(() => dimensionRange(TABS, range)).toThrow(expect.objectContaining({ code: "invalid_argument" }))
  })

  test("refuses a block of rows with an open end", () => {
    expect(() => dimensionOf({ sheetId: 0, startRowIndex: 2 }, "3:")).toThrow(/whole rows/)
  })
})
