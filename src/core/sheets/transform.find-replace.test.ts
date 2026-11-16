import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID } from "./structure.testing"
import { refusedTransform, sendTransform } from "./transform.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FLAGS_OFF = {
  matchCase: false,
  matchEntireCell: false,
  searchByRegex: false,
  includeFormulas: false,
}

describe("google_sheets_transform: find_replace", () => {
  test("replaces in a range, removing the matches when no replacement is given", async () => {
    const { requests, result } = await sendTransform([{ op: "find_replace", find: "N/A", range: "Plan!B2:B50" }])

    expect(requests).toEqual([
      { findReplace: { find: "N/A", replacement: "", ...FLAGS_OFF, range: PLAN_GRID(1, 50, 1, 2) } },
    ])
    expect(result.applied).toEqual(['find_replace "N/A" with nothing in Plan!B2:B50'])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("replaces in the whole of a tab by its id", async () => {
    const { requests, result } = await sendTransform([
      { op: "find_replace", find: "a", replacement: "b", tab: "my tab", match_case: true },
    ])

    expect(requests).toEqual([
      { findReplace: { find: "a", replacement: "b", ...FLAGS_OFF, matchCase: true, sheetId: 77 } },
    ])
    expect(result.applied).toEqual(['find_replace "a" with "b" in \'My Tab\' (whole tab) (match case)'])
  })

  test("replaces in every tab, and names each of them as changed", async () => {
    const { requests, result } = await sendTransform([
      {
        op: "find_replace",
        find: "x.",
        replacement: "y",
        all_tabs: true,
        regex: true,
        whole_cell: true,
        formulas: true,
      },
    ])

    expect(requests).toEqual([
      {
        findReplace: {
          find: "x.",
          replacement: "y",
          matchCase: false,
          matchEntireCell: true,
          searchByRegex: true,
          includeFormulas: true,
          allSheets: true,
        },
      },
    ])
    expect(result.applied).toEqual(['find_replace "x." with "y" in every tab (whole cell, regex, formulas too)'])
    expect(result.tabs).toEqual(["Plan", "My Tab", "a/b"])
  })

  test.each([
    ["no scope", {}],
    ["a range and a tab", { range: "Plan!A1:B2", tab: "Plan" }],
    ["a tab and all_tabs", { tab: "Plan", all_tabs: true }],
    ["all three", { range: "Plan!A1:B2", tab: "Plan", all_tabs: true }],
    ["all_tabs: false", { all_tabs: false }],
  ])("takes exactly one scope: refuses %s", async (_name, scope) => {
    const error = await refusedTransform([{ op: "find_replace", find: "a", ...scope }])

    expect(error.code).toBe("invalid_argument")
  })

  test("refuses an empty text to find and a tab the spreadsheet lacks", async () => {
    expect((await refusedTransform([{ op: "find_replace", find: "", tab: "Plan" }])).code).toBe("invalid_argument")
    expect((await refusedTransform([{ op: "find_replace", find: "a", tab: "Nope" }])).message).toContain("names no tab")
  })

  test("reports what Google changed, and zeros where it leaves the counts out", async () => {
    const counted = await sendTransform([{ op: "find_replace", find: "a", all_tabs: true }], {
      reply: {
        replies: [
          {
            findReplace: {
              occurrencesChanged: 7,
              valuesChanged: 5,
              formulasChanged: 1,
              rowsChanged: 4,
              sheetsChanged: 2,
            },
          },
        ],
      },
    })
    const none = await sendTransform([{ op: "find_replace", find: "a", all_tabs: true }], {
      reply: { replies: [{ findReplace: {} }] },
    })

    expect(counted.result.results).toEqual([
      {
        op: "find_replace",
        occurrences_changed: 7,
        values_changed: 5,
        formulas_changed: 1,
        rows_changed: 4,
        tabs_changed: 2,
      },
    ])
    expect(none.result.results).toEqual([
      {
        op: "find_replace",
        occurrences_changed: 0,
        values_changed: 0,
        formulas_changed: 0,
        rows_changed: 0,
        tabs_changed: 0,
      },
    ])
  })

  test("maps each operation's replies back to it, whatever the number of requests an operation made", async () => {
    const { result } = await sendTransform(
      [
        { op: "trim", ranges: ["Plan!A1:A2", "Plan!B1:B2"] },
        { op: "sort", range: "Plan!A1:C9", by: [{ column: "A" }] },
        { op: "find_replace", find: "a", range: "Plan!A1:C9" },
        { op: "dedupe", range: "Plan!A1:C9" },
      ],
      {
        reply: {
          replies: [
            { trimWhitespace: { cellsChangedCount: 1 } },
            { trimWhitespace: { cellsChangedCount: 2 } },
            {},
            { findReplace: { occurrencesChanged: 3 } },
            { deleteDuplicates: { duplicatesRemovedCount: 6 } },
          ],
        },
      },
    )

    expect(result.results).toEqual([
      { op: "trim", cells_changed: 3 },
      { op: "sort" },
      {
        op: "find_replace",
        occurrences_changed: 3,
        values_changed: 0,
        formulas_changed: 0,
        rows_changed: 0,
        tabs_changed: 0,
      },
      { op: "dedupe", duplicates_removed: 6 },
    ])
  })
})
