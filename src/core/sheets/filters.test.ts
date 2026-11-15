import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS, refusedCall, sendAdd, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const MY_TAB = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
  ...PLAN_GRID(startRowIndex, endRowIndex, startColumnIndex, endColumnIndex),
  sheetId: 77,
})

const CRITERIA = [
  { column: "b", hide: ["x", 1] },
  { column: "C", when: "NUMBER_GREATER", values: [5] },
]

const SPECS = [
  { columnIndex: 1, filterCriteria: { hiddenValues: ["x", "1"] } },
  { columnIndex: 2, filterCriteria: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "5" }] } } },
]

describe("google_sheets_add: filter", () => {
  test("sets the basic filter of a tab that has none, with the criteria by column", async () => {
    const { body, result } = await sendAdd(
      [
        { op: "filter", range: "'My Tab'!A1:D20", filter_columns: CRITERIA },
        { op: "filter", range: "a/b!A1:B2" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      { setBasicFilter: { filter: { range: MY_TAB(0, 20, 0, 4), filterSpecs: SPECS } } },
      { setBasicFilter: { filter: { range: { ...PLAN_GRID(0, 2, 0, 2), sheetId: 5 }, filterSpecs: [] } } },
    ])
    expect(result.applied).toEqual([
      "filter 'My Tab'!A1:D20: B hide (x, 1); C show NUMBER_GREATER 5",
      "filter 'a/b'!A1:B2",
    ])
  })

  test("refuses a tab that has a filter, naming the operation that replaces it, and a tab the call gave one", async () => {
    const has = await refusedCall("add", [{ op: "filter", range: "Plan!A1:F9" }])
    expect(has.code).toBe("invalid_argument")
    expect(has.message).toContain('"Plan" already has a filter')
    expect(has.message).toContain("google_sheets_restructure's filter_replace")

    const twice = await refusedCall("add", [
      { op: "filter", range: "'My Tab'!A1:C9" },
      { op: "filter", range: "'My Tab'!A1:D9" },
    ])
    expect(twice.message).toContain('"My Tab" already has a filter')
  })

  test.each([
    [
      "a column outside the range",
      { range: "'My Tab'!A1:C9", filter_columns: [{ column: "D", hide: ["a"] }] },
      "D is outside",
    ],
    ["values without a condition", { range: "A1:C9", filter_columns: [{ column: "A", values: [1] }] }, "need `when`"],
    ["a column with no criteria", { range: "A1:C9", filter_columns: [{ column: "A" }] }, "needs `hide` or `when`"],
    ["a column that is not letters", { range: "A1:C9", filter_columns: [{ column: "1", hide: ["a"] }] }, "letters"],
  ])("refuses %s, and sends nothing", async (_name, op, message) => {
    const error = await refusedCall("add", [{ op: "filter", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_restructure: filter_replace and filter_clear", () => {
  test("replaces the basic filter a tab has, and sets one on a tab that has none", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "filter_replace", range: "Plan!A1:F99", filter_columns: [{ column: "A", hide: ["z"] }] },
        { op: "filter_replace", range: "'My Tab'!A1:C9" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        setBasicFilter: {
          filter: {
            range: PLAN_GRID(0, 99, 0, 6),
            filterSpecs: [{ columnIndex: 0, filterCriteria: { hiddenValues: ["z"] } }],
          },
        },
      },
      { setBasicFilter: { filter: { range: MY_TAB(0, 9, 0, 3), filterSpecs: [] } } },
    ])
    expect(result.applied).toEqual([
      "filter_replace Plan!A1:F99 (replaces the tab's filter): A hide (z)",
      "filter_replace 'My Tab'!A1:C9",
    ])
  })

  test("clears the filter of a tab, the first tab when none is named", async () => {
    const { body, result } = await sendRestructure([{ op: "filter_clear" }], { spreadsheet: WITH_OBJECTS })

    expect(body.requests).toEqual([{ clearBasicFilter: { sheetId: 0 } }])
    expect(result.applied).toEqual(["filter_clear Plan"])
  })

  test("refuses to clear a tab that has no filter, or one the call cleared already", async () => {
    const none = await refusedCall("restructure", [{ op: "filter_clear", tab: "my tab" }])
    expect(none.code).toBe("invalid_argument")
    expect(none.message).toContain('"My Tab" has no filter to clear')

    const twice = await refusedCall("restructure", [{ op: "filter_clear" }, { op: "filter_clear", tab: "Plan" }])
    expect(twice.message).toContain('"Plan" has no filter to clear')
  })

  test("clears a filter the call set, and sets one again after clearing", async () => {
    const { body } = await sendRestructure(
      [
        { op: "filter_replace", range: "'My Tab'!A1:C9" },
        { op: "filter_clear", tab: "My Tab" },
        { op: "filter_clear", tab: "Plan" },
        { op: "filter_replace", range: "Plan!A1:C9" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests.map((request: any) => Object.keys(request)[0])).toEqual([
      "setBasicFilter",
      "clearBasicFilter",
      "clearBasicFilter",
      "setBasicFilter",
    ])
  })
})

describe("google_sheets_add: filter_view", () => {
  test("adds a view of a range with its criteria, and lists the view's id as Google answered", async () => {
    const { body, result } = await sendAdd(
      [{ op: "filter_view", range: "Plan!A1:F50", name: " Late ", filter_columns: CRITERIA }],
      {
        spreadsheet: WITH_OBJECTS,
        reply: { replies: [{ addFilterView: { filter: { filterViewId: 9100, title: "Late" } } }] },
      },
    )

    expect(body.requests).toEqual([
      { addFilterView: { filter: { title: "Late", range: PLAN_GRID(0, 50, 0, 6), filterSpecs: SPECS } } },
    ])
    expect(result.applied).toEqual(['filter_view "Late" on Plan!A1:F50: B hide (x, 1); C show NUMBER_GREATER 5'])
    expect(result.filter_views).toEqual([{ view_id: 9100, title: "Late" }])
  })

  test("refuses a view with no name, and a criterion outside its range", async () => {
    for (const operation of [
      { op: "filter_view", range: "Plan!A1:F50" },
      { op: "filter_view", range: "Plan!A1:C50", name: "X", filter_columns: [{ column: "F", hide: ["a"] }] },
    ]) {
      expect((await refusedCall("add", [operation])).code).toBe("invalid_argument")
    }
  })
})

describe("google_sheets_restructure: filter_view_update and filter_view_delete", () => {
  test("changes the view by its id, or its title ignoring case, and only what is given", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "filter_view_update", view: 9001, name: "Done", range: "A1:D9", filter_columns: CRITERIA },
        { op: "filter_view_update", view: "MINE", filter_columns: [] },
        { op: "filter_view_update", view: "9002", range: "'My Tab'!A1:C9" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        updateFilterView: {
          filter: { filterViewId: 9001, range: PLAN_GRID(0, 9, 0, 4), title: "Done", filterSpecs: SPECS },
          fields: "range,title,filterSpecs",
        },
      },
      { updateFilterView: { filter: { filterViewId: 9002, filterSpecs: [] }, fields: "filterSpecs" } },
      { updateFilterView: { filter: { filterViewId: 9002, range: MY_TAB(0, 9, 0, 3) }, fields: "range" } },
    ])
    expect(result.applied).toEqual([
      'filter_view_update "Open": rename to "Done", range Plan!A1:D9, replace criteria with B hide (x, 1); C show NUMBER_GREATER 5',
      'filter_view_update "Mine": remove all criteria',
      "filter_view_update \"Mine\": range 'My Tab'!A1:C9",
    ])
    expect(result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("deletes a view by its id or its title, and then no longer finds it", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "filter_view_delete", view: 9001 },
        { op: "filter_view_delete", view: "mine" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([{ deleteFilterView: { filterId: 9001 } }, { deleteFilterView: { filterId: 9002 } }])
    expect(result.applied).toEqual([
      'filter_view_delete "Open" (Plan!A1:F50)',
      'filter_view_delete "Mine" (Plan!A1:C20)',
    ])

    const error = await refusedCall("restructure", [
      { op: "filter_view_delete", view: "Open" },
      { op: "filter_view_update", view: 9001, name: "X" },
    ])
    expect(error.message).toContain('No filter view matches "9001"')
  })

  test.each([
    ["an unknown view", { op: "filter_view_delete", view: "Nope" }, 'No filter view matches "Nope"'],
    ["an unknown id", { op: "filter_view_update", view: 1, name: "X" }, 'No filter view matches "1"'],
    ["no change", { op: "filter_view_update", view: "Open" }, "Give `range`, `name` or `filter_columns`"],
    [
      "a criterion outside the view's range",
      { op: "filter_view_update", view: "Mine", filter_columns: [{ column: "D", hide: ["a"] }] },
      "D is outside",
    ],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refusedCall("restructure", [operation])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("lists the views a spreadsheet has when none matches", async () => {
    const error = await refusedCall("restructure", [{ op: "filter_view_delete", view: "Nope" }])

    expect(error.message).toContain("Open, Mine")
  })
})
