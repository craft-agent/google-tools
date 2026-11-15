import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { columnLetters, gridRangeA1, quoteTab } from "./a1"

describe("columnLetters", () => {
  test.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [18277, "ZZZ"],
  ])("column %d is %s", (index, letters) => {
    expect(columnLetters(index)).toBe(letters)
  })

  test.each([-1, 1.5, Number.NaN])("refuses %p as internal_error", (index) => {
    expect(() => columnLetters(index)).toThrow(ToolError)
  })
})

describe("quoteTab", () => {
  test.each(["Sheet1", "_data", "Budget_2026", "Tab"])("leaves %p bare", (title) => {
    expect(quoteTab(title)).toBe(title)
  })

  test.each([
    ["My tab", "'My tab'"],
    ["2026", "'2026'"],
    ["Q1-2026", "'Q1-2026'"],
    ["It's", "'It''s'"],
    ["日本語", "'日本語'"],
    ["", "''"],
  ])("quotes %p", (title, quoted) => {
    expect(quoteTab(title)).toBe(quoted)
  })

  test.each(["A1", "a1", "AB12", "XFD1048576", "R1C1", "r2c3", "RC", "R", "C", "R1C", "RC2"])(
    "quotes %p, which reads as a cell",
    (title) => {
      expect(quoteTab(title)).toBe(`'${title}'`)
    },
  )

  test("a name that only starts like a cell stays bare", () => {
    expect(quoteTab("A1b")).toBe("A1b")
    expect(quoteTab("ABCD1")).toBe("ABCD1")
  })
})

describe("gridRangeA1", () => {
  test("a bounded range is Tab!A1:C10, zero-based and end exclusive", () => {
    expect(gridRangeA1("Sheet1", { startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 3 })).toBe(
      "Sheet1!A1:C10",
    )
    expect(gridRangeA1("Sheet1", { startRowIndex: 1, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 28 })).toBe(
      "Sheet1!B2:AB5",
    )
  })

  test("a start Google leaves out is 0", () => {
    expect(gridRangeA1("Sheet1", { endRowIndex: 10, endColumnIndex: 3 })).toBe("Sheet1!A1:C10")
  })

  test("only columns are whole columns", () => {
    expect(gridRangeA1("Sheet1", { startColumnIndex: 0, endColumnIndex: 3 })).toBe("Sheet1!A:C")
    expect(gridRangeA1("Sheet1", { endColumnIndex: 1 })).toBe("Sheet1!A:A")
  })

  test("only rows are whole rows", () => {
    expect(gridRangeA1("Sheet1", { startRowIndex: 0, endRowIndex: 5 })).toBe("Sheet1!1:5")
    expect(gridRangeA1("Sheet1", { startRowIndex: 1, endRowIndex: 5 })).toBe("Sheet1!2:5")
  })

  test("no bounds is the whole tab, quoted when it needs to be", () => {
    expect(gridRangeA1("Sheet1")).toBe("Sheet1")
    expect(gridRangeA1("My tab", {})).toBe("'My tab'")
  })

  test("an end left open stays empty", () => {
    expect(gridRangeA1("Sheet1", { startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 })).toBe("Sheet1!A2:C")
  })

  test("the title is quoted in a range too", () => {
    expect(gridRangeA1("It's here", { endRowIndex: 2, endColumnIndex: 2 })).toBe("'It''s here'!A1:B2")
  })
})
