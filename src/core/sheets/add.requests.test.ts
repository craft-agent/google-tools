import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { PLAN_COLUMNS, PLAN_ROWS, sendAdd } from "./structure.testing"
import { BATCH_UPDATE_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_sheets_add: insert", () => {
  test("inserts as many rows as the range spans before them, taking the formatting of the row before", async () => {
    const { body } = await sendAdd([{ op: "insert", range: "Plan!5:7" }])

    expect(body).toEqual({
      requests: [{ insertDimension: { range: PLAN_ROWS(4, 7), inheritFromBefore: true } }],
      includeSpreadsheetInResponse: false,
    })
  })

  test("inserts columns for a range of whole columns, and names the tab by its title ignoring case", async () => {
    const { body } = await sendAdd([{ op: "insert", range: "plan!C:D", inherit: "before" }])

    expect(body.requests).toEqual([{ insertDimension: { range: PLAN_COLUMNS(2, 4), inheritFromBefore: true } }])
  })

  test("takes the formatting of the rows after when asked, which the first row may do", async () => {
    const { body } = await sendAdd([{ op: "insert", range: "Plan!1:2", inherit: "after" }])

    expect(body.requests).toEqual([{ insertDimension: { range: PLAN_ROWS(0, 2), inheritFromBefore: false } }])
  })

  test.each([
    ["rows", "Plan!1:1", "first row"],
    ["columns", "Plan!A:B", "first column"],
  ])(
    "refuses to inherit from before the first of the %s, by default too, and sends nothing",
    async (_name, range, first) => {
      const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

      for (const op of [
        { op: "insert", range },
        { op: "insert", range, inherit: "before" },
      ]) {
        const error = await toolError(h.add({ spreadsheet: SPREADSHEET_ID, operations: [op] }))

        expect(error.code).toBe("invalid_argument")
        expect(error.message).toContain(first)
        expect(error.message).toContain('inherit: "after"')
      }
      expect(writesOf(h.requests)).toEqual([])
    },
  )

  test("refuses a block, a whole tab and a missing range, and takes only one range", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    for (const op of [
      { op: "insert", range: "Plan!A1:B2" },
      { op: "insert", range: "Plan" },
    ]) {
      const error = await toolError(h.add({ spreadsheet: SPREADSHEET_ID, operations: [op] }))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("whole rows")
    }
    for (const op of [
      { op: "insert" },
      { op: "insert", ranges: ["Plan!5:7"] },
      { op: "insert", range: "Plan!5:7", inherit: "up" },
    ]) {
      expect((await toolError(h.add({ spreadsheet: SPREADSHEET_ID, operations: [op] }))).code).toBe("invalid_argument")
    }
    expect(writesOf(h.requests)).toEqual([])
  })

  test("sends the inserts of one call in order, in one batch", async () => {
    const { body, result } = await sendAdd([
      { op: "insert", range: "Plan!3:3" },
      { op: "insert", range: "'My Tab'!B:B", inherit: "after" },
      { op: "insert", range: "Plan!3:4" },
    ])

    expect(body.requests).toEqual([
      { insertDimension: { range: PLAN_ROWS(2, 3), inheritFromBefore: true } },
      {
        insertDimension: {
          range: { sheetId: 77, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          inheritFromBefore: false,
        },
      },
      { insertDimension: { range: PLAN_ROWS(2, 4), inheritFromBefore: true } },
    ])
    expect(result).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      applied: [
        "insert 1 row before Plan!3:3, formatted like the row before",
        "insert 1 column before 'My Tab'!B:B, formatted like the column after",
        "insert 2 rows before Plan!3:4, formatted like the row before",
      ],
      requests: 3,
      tabs: ["Plan", "My Tab"],
      created: [],
      tables: [],
      filter_views: [],
      charts: [],
    })
  })
})

describe("google_sheets_add: tab_duplicate", () => {
  const reply = (properties: object) => ({ replies: [{ duplicateSheet: { properties } }] })

  test("copies the tab right after itself, and lists the new tab as Google answered", async () => {
    const { body, result } = await sendAdd([{ op: "tab_duplicate", tab: "My Tab" }], {
      reply: reply({ sheetId: 910, title: "Copy of My Tab", index: 2 }),
    })

    expect(body.requests).toEqual([{ duplicateSheet: { sourceSheetId: 77, insertSheetIndex: 2 } }])
    expect(result).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      applied: ["tab_duplicate 'My Tab' next to it"],
      requests: 1,
      tabs: [],
      created: [{ sheet_id: 910, title: "Copy of My Tab", index: 2 }],
      tables: [],
      filter_views: [],
      charts: [],
    })
  })

  test("gives the copy the title and the position asked for, counted from 0 and kept within the tabs", async () => {
    const { body } = await sendAdd(
      [
        { op: "tab_duplicate", tab: "Plan", title: "Plan 2", position: 0 },
        { op: "tab_duplicate", tab: "Plan", title: "Plan 3", position: 99 },
      ],
      { reply: { replies: [{}, {}] } },
    )

    expect(body.requests).toEqual([
      { duplicateSheet: { sourceSheetId: 0, insertSheetIndex: 0, newSheetName: "Plan 2" } },
      { duplicateSheet: { sourceSheetId: 0, insertSheetIndex: 4, newSheetName: "Plan 3" } },
    ])
  })

  test("places a copy after the tab that earlier copies moved along", async () => {
    const { body } = await sendAdd(
      [
        { op: "tab_duplicate", tab: "Plan", position: 0 },
        { op: "tab_duplicate", tab: "My Tab" },
      ],
      { reply: { replies: [{}, {}] } },
    )

    expect(body.requests).toEqual([
      { duplicateSheet: { sourceSheetId: 0, insertSheetIndex: 0 } },
      { duplicateSheet: { sourceSheetId: 77, insertSheetIndex: 3 } },
    ])
  })

  test("lists each copy in the order of the operations, and the tabs an insert changed apart from them", async () => {
    const { result } = await sendAdd(
      [
        { op: "tab_duplicate", tab: "Plan", title: "A" },
        { op: "insert", range: "Plan!2:2" },
        { op: "tab_duplicate", tab: "a/b", title: "B" },
      ],
      {
        reply: {
          replies: [
            { duplicateSheet: { properties: { sheetId: 11, title: "A", index: 1 } } },
            {},
            { duplicateSheet: { properties: { sheetId: 12, title: "B", index: 4 } } },
          ],
        },
      },
    )

    expect(result.created).toEqual([
      { sheet_id: 11, title: "A", index: 1 },
      { sheet_id: 12, title: "B", index: 4 },
    ])
    expect(result.tabs).toEqual(["Plan"])
  })

  test.each([
    ["a title another tab has, in other case", "my tab"],
    ["a title an earlier copy of the call takes", "Copy"],
  ])("refuses %s, and sends nothing", async (_name, title) => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.add({
        spreadsheet: SPREADSHEET_ID,
        operations: [
          { op: "tab_duplicate", tab: "Plan", title: "copy" },
          { op: "tab_duplicate", tab: "Plan", title },
        ],
      }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must be new, ignoring case")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("refuses a tab the spreadsheet lacks, naming its tabs, and a title that is empty or too long", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.add({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "tab_duplicate", tab: "Nope" }] }),
    )
    expect(error.message).toContain("Plan, My Tab, a/b")
    for (const title of ["", "x".repeat(101)]) {
      const refused = await toolError(
        h.add({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "tab_duplicate", tab: "Plan", title }] }),
      )
      expect(refused.code).toBe("invalid_argument")
    }
    expect(writesOf(h.requests)).toEqual([])
  })
})

describe("google_sheets_add: the call", () => {
  test("is refused for an operation outside its vocabulary, naming the ones it offers", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.add({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "delete", range: "Plan!2:3" }] }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(
      'Unknown operation "delete"; the operations are: insert, tab_duplicate, table, conditional, validate, filter, filter_view, chart, pivot.',
    )
    expect(h.requests).toEqual([])
  })

  test("passes Google's refusal of the batch on", async () => {
    const h = await writeFixture([
      metadata(),
      {
        method: "POST",
        url: BATCH_UPDATE_URL,
        reply: {
          status: 400,
          json: { error: { code: 400, message: "Invalid requests[0]", status: "INVALID_ARGUMENT" } },
        },
      },
    ])

    const error = await toolError(
      h.add({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "insert", range: "Plan!2:2" }] }),
    )

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Invalid requests[0]")
  })
})
