import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { PLAN_COLUMNS, PLAN_ROWS, WITH_HIDDEN_TAB, sendRestructure } from "./structure.testing"
import { BATCH_UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const PLAN_BLOCK = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
  sheetId: 0,
  startRowIndex,
  endRowIndex,
  startColumnIndex,
  endColumnIndex,
})

describe("google_sheets_restructure: delete", () => {
  test("deletes whole rows, and whole columns, with the ranges as Google resolves them", async () => {
    const { body, result } = await sendRestructure([
      { op: "delete", range: "Plan!5:7" },
      { op: "delete", range: "'My Tab'!B:C" },
    ])

    expect(body).toEqual({
      requests: [
        { deleteDimension: { range: PLAN_ROWS(4, 7) } },
        { deleteDimension: { range: { sheetId: 77, dimension: "COLUMNS", startIndex: 1, endIndex: 3 } } },
      ],
      includeSpreadsheetInResponse: false,
    })
    expect(result.applied).toEqual(["delete Plan!5:7", "delete 'My Tab'!B:C"])
  })

  test("sends several ranges of one tab from the bottom up and from the right to the left, so no delete shifts the next", async () => {
    const { body, result } = await sendRestructure([
      { op: "delete", ranges: ["Plan!2:3", "Plan!10:12", "Plan!4:5", "Plan!7:7", "Plan!B:B", "Plan!D:E"] },
    ])

    expect(body.requests).toEqual([
      { deleteDimension: { range: PLAN_ROWS(9, 12) } },
      { deleteDimension: { range: PLAN_ROWS(6, 7) } },
      { deleteDimension: { range: PLAN_ROWS(3, 5) } },
      { deleteDimension: { range: PLAN_COLUMNS(3, 5) } },
      { deleteDimension: { range: PLAN_ROWS(1, 3) } },
      { deleteDimension: { range: PLAN_COLUMNS(1, 2) } },
    ])
    expect(result.applied).toEqual(["delete Plan!2:3, Plan!10:12, Plan!4:5, Plan!7:7 +2"])
  })

  test.each([
    ["rows", ["Plan!4:8", "Plan!2:5"], "Plan!2:5", "Plan!4:8"],
    ["columns", ["Plan!D:D", "Plan!B:D"], "Plan!B:D", "Plan!D:D"],
    ["the same rows twice", ["Plan!3:3", "Plan!3:3"], "Plan!3:3", "Plan!3:3"],
  ])("refuses ranges of %s that overlap, naming both, and sends nothing", async (_name, ranges, upper, lower) => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "delete", ranges }] }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`"${upper}" and "${lower}" overlap`)
    expect(writesOf(h.requests)).toEqual([])
  })

  test("takes rows and columns of one tab, and ranges of several tabs, that do not overlap", async () => {
    const { body } = await sendRestructure([{ op: "delete", ranges: ["Plan!2:3", "Plan!B:C", "a/b!2:3"] }])

    expect(body.requests).toHaveLength(3)
  })

  test.each([
    ["a block", { op: "delete", range: "Plan!A1:B2" }],
    ["a whole tab", { op: "delete", range: "Plan" }],
    ["a row range with an open end", { op: "delete", range: "Plan!3:" }],
    ["a range of a tab the spreadsheet lacks", { op: "delete", range: "Nope!3:4" }],
  ])("refuses %s as invalid_argument and sends nothing", async (_name, operation) => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    const error = await toolError(h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [operation] }))

    expect(error.code).toBe("invalid_argument")
    expect(writesOf(h.requests)).toEqual([])
  })
})

describe("google_sheets_restructure: move", () => {
  test("moves rows in front of a row number, and columns in front of a column letter", async () => {
    const { body, result } = await sendRestructure([
      { op: "move", range: "Plan!2:3", to: 10 },
      { op: "move", range: "'My Tab'!A:B", to: "e" },
      { op: "move", range: "a/b!5:5", to: "1" },
    ])

    expect(body.requests).toEqual([
      { moveDimension: { source: PLAN_ROWS(1, 3), destinationIndex: 9 } },
      {
        moveDimension: {
          source: { sheetId: 77, dimension: "COLUMNS", startIndex: 0, endIndex: 2 },
          destinationIndex: 4,
        },
      },
      { moveDimension: { source: { sheetId: 5, dimension: "ROWS", startIndex: 4, endIndex: 5 }, destinationIndex: 0 } },
    ])
    expect(result.applied).toEqual([
      "move Plan!2:3 before row 10",
      "move 'My Tab'!A:B before column E",
      "move 'a/b'!5:5 before row 1",
    ])
  })

  test.each([
    ["a column letter for rows", { range: "Plan!2:3", to: "B" }],
    ["a row number for columns", { range: "Plan!B:C", to: 5 }],
    ["a row number as text for columns", { range: "Plan!B:C", to: "5" }],
    ["row 0", { range: "Plan!2:3", to: 0 }],
    ["a row number with a sign", { range: "Plan!2:3", to: "+4" }],
    ["four column letters", { range: "Plan!B:C", to: "ABCD" }],
    ["a block", { range: "Plan!A1:B2", to: 4 }],
  ])("refuses %s as invalid_argument and sends nothing", async (_name, operation) => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "move", ...operation }] }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("takes one range and a destination, and nothing else", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    for (const operation of [
      { op: "move", ranges: ["Plan!2:3"], to: 5 },
      { op: "move", range: "Plan!2:3" },
      { op: "move", range: "Plan!2:3", to: 5, extra: true },
    ]) {
      const error = await toolError(h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [operation] }))
      expect(error.code).toBe("invalid_argument")
    }
    expect(writesOf(h.requests)).toEqual([])
  })
})

describe("google_sheets_restructure: merge", () => {
  test("merges all of each range by default, and by columns or by rows when asked", async () => {
    const { body, result } = await sendRestructure([
      { op: "merge", range: "Plan!A1:C2" },
      { op: "merge", ranges: ["Plan!B4:D6", "'My Tab'!A1:B2"], merge: "columns" },
      { op: "merge", range: "Plan!F1:G3", merge: "rows" },
    ])

    expect(body.requests).toEqual([
      { mergeCells: { range: PLAN_BLOCK(0, 2, 0, 3), mergeType: "MERGE_ALL" } },
      { mergeCells: { range: PLAN_BLOCK(3, 6, 1, 4), mergeType: "MERGE_COLUMNS" } },
      {
        mergeCells: {
          range: { sheetId: 77, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 2 },
          mergeType: "MERGE_COLUMNS",
        },
      },
      { mergeCells: { range: PLAN_BLOCK(0, 3, 5, 7), mergeType: "MERGE_ROWS" } },
    ])
    expect(result.applied).toEqual([
      "merge Plan!A1:C2",
      "merge Plan!B4:D6, 'My Tab'!A1:B2 by columns",
      "merge Plan!F1:G3 by rows",
    ])
  })

  test("refuses a mode outside all, columns and rows, and no range or both", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    for (const operation of [
      { op: "merge", range: "A1:B2", merge: "diagonal" },
      { op: "merge", merge: "all" },
      { op: "merge", range: "A1:B2", ranges: ["C1:D2"] },
    ]) {
      const error = await toolError(h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [operation] }))
      expect(error.code).toBe("invalid_argument")
    }
    expect(writesOf(h.requests)).toEqual([])
  })
})

describe("google_sheets_restructure: tabs and the spreadsheet", () => {
  test("deletes a tab, renames a tab, and renames the spreadsheet", async () => {
    const { body, result } = await sendRestructure([
      { op: "tab_delete", tab: "a/b" },
      { op: "tab_rename", tab: "my tab", title: "Notes" },
      { op: "spreadsheet_rename", title: "Budget 2028" },
    ])

    expect(body.requests).toEqual([
      { deleteSheet: { sheetId: 5 } },
      { updateSheetProperties: { properties: { sheetId: 77, title: "Notes" }, fields: "title" } },
      { updateSpreadsheetProperties: { properties: { title: "Budget 2028" }, fields: "title" } },
    ])
    expect(result.applied).toEqual([
      "tab_delete 'a/b' with all its contents",
      "tab_rename 'My Tab' to \"Notes\"",
      'spreadsheet_rename "Budget 2028"',
    ])
    expect(result.tabs).toEqual(["My Tab", "a/b"])
  })

  test("sets the locale, the time zone, or both, naming only what is given in the mask", async () => {
    const { body, result } = await sendRestructure([
      { op: "spreadsheet_settings", locale: "ja_JP" },
      { op: "spreadsheet_settings", time_zone: "Asia/Tokyo" },
      { op: "spreadsheet_settings", locale: "en_US", time_zone: "UTC" },
    ])

    expect(body.requests).toEqual([
      { updateSpreadsheetProperties: { properties: { locale: "ja_JP" }, fields: "locale" } },
      { updateSpreadsheetProperties: { properties: { timeZone: "Asia/Tokyo" }, fields: "timeZone" } },
      { updateSpreadsheetProperties: { properties: { locale: "en_US", timeZone: "UTC" }, fields: "locale,timeZone" } },
    ])
    expect(result.applied[2]).toBe("spreadsheet_settings locale en_US, time zone UTC")
    expect(result.tabs).toEqual([])
  })

  test.each([
    ["no setting", {}],
    ["a locale with a dash", { locale: "ja-JP" }],
    ["an upper-case language", { locale: "JA" }],
    ["a time zone that is none", { time_zone: "Mars/Olympus" }],
    ["an offset as time zone", { time_zone: "+09:00" }],
    ["an empty time zone", { time_zone: "" }],
  ])("refuses %s", async (_name, settings) => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "spreadsheet_settings", ...settings }] }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("lets a hidden tab go while a visible one stays, and plans a later operation on the new title of a renamed tab", async () => {
    const { body } = await sendRestructure(
      [
        { op: "tab_rename", tab: "Plan", title: "Budget" },
        { op: "tab_delete", tab: "my tab" },
        { op: "tab_rename", tab: "budget", title: "Final" },
      ],
      { spreadsheet: WITH_HIDDEN_TAB },
    )

    expect(body.requests).toEqual([
      { updateSheetProperties: { properties: { sheetId: 0, title: "Budget" }, fields: "title" } },
      { deleteSheet: { sheetId: 77 } },
      { updateSheetProperties: { properties: { sheetId: 0, title: "Final" }, fields: "title" } },
    ])
  })
})
