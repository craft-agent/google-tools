import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { writeTargets } from "../targets"
import { googleSheetsTabAdd } from "./tab-add"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { BATCH_UPDATE_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const ADDED = {
  replies: [
    {
      addSheet: {
        properties: { sheetId: 900, title: "Notes", index: 3, gridProperties: { rowCount: 50, columnCount: 4 } },
      },
    },
  ],
}

const handlers = () => [metadata(), post(BATCH_UPDATE_URL, ADDED)]

const TAB = { spreadsheet: SPREADSHEET_ID, title: "Notes" }

describe("google_sheets_tab_add", () => {
  test("adds a tab with only its title", async () => {
    const h = await writeFixture(handlers())

    await h.tabAdd(TAB)

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${BATCH_UPDATE_URL}`])
    expect(writesOf(h.requests)[0]!.json).toEqual({ requests: [{ addSheet: { properties: { title: "Notes" } } }] })
  })

  test("adds a tab with its position and size", async () => {
    const h = await writeFixture(handlers())

    await h.tabAdd({ ...TAB, index: 1, rows: 50, columns: 4 })

    expect(writesOf(h.requests)[0]!.json).toEqual({
      requests: [
        { addSheet: { properties: { title: "Notes", index: 1, gridProperties: { rowCount: 50, columnCount: 4 } } } },
      ],
    })
  })

  test("sends only the size dimension that was given, and an index of 0", async () => {
    const h = await writeFixture(handlers())

    await h.tabAdd({ ...TAB, index: 0, columns: 4 })

    expect(writesOf(h.requests)[0]!.json).toEqual({
      requests: [{ addSheet: { properties: { title: "Notes", index: 0, gridProperties: { columnCount: 4 } } } }],
    })
  })

  test("returns the tab as Google reports it", async () => {
    const h = await writeFixture(handlers())

    expect(await h.tabAdd(TAB)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      tab: { sheet_id: 900, title: "Notes", index: 3, row_count: 50, column_count: 4 },
    })
  })

  test("refuses a title a tab has, ignoring case, naming it, and writes nothing", async () => {
    const h = await writeFixture(handlers())

    const error = await toolError(h.tabAdd({ ...TAB, title: "my tab" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"My Tab"')
    expect(writesOf(h.requests)).toEqual([])
  })

  test("fails for a label that cannot write before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.tabAdd(TAB))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["an empty title", { title: "" }],
    ["a title over 100 characters", { title: "x".repeat(101) }],
    ["a negative index", { index: -1 }],
    ["0 rows", { rows: 0 }],
    ["too many rows", { rows: 100001 }],
    ["0 columns", { columns: 0 }],
    ["too many columns", { columns: 18279 }],
  ])("refuses %s", (_name, extra) => {
    expect(googleSheetsTabAdd.input.safeParse({ ...TAB, ...extra }).success).toBe(false)
  })
})

describe("google_sheets_tab_add: targets and describe", () => {
  test("the target is the spreadsheet, as the tab has no id yet", async () => {
    const h = await writeFixture(handlers())

    expect(await writeTargets(googleSheetsTabAdd, TAB, h.ctx)).toEqual([`work/spreadsheets/${SPREADSHEET_ID}`])
  })

  test("the target is `*` for a title that is taken, and for a label that cannot write, before any request", async () => {
    const h = await writeFixture(handlers())
    const readOnly = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    expect(await writeTargets(googleSheetsTabAdd, { ...TAB, title: "Plan" }, h.ctx)).toEqual(["*"])
    expect(await writeTargets(googleSheetsTabAdd, TAB, readOnly.ctx)).toEqual(["*"])
    expect(readOnly.requests).toEqual([])
  })

  test("describes the tab from the argument and the spreadsheet as Google reports it", async () => {
    const h = await writeFixture(handlers())
    const describe = (args: unknown) => googleSheetsTabAdd.describe!(googleSheetsTabAdd.input.parse(args), h.ctx)

    expect(await describe({ ...TAB, index: 2, rows: 10, columns: 5 })).toEqual({
      headline: {
        text: "About to add the tab {tab} to {spreadsheet}",
        values: { tab: "Notes", spreadsheet: "Budget 2027" },
      },
      facts: [
        { label: "Position", value: "2" },
        { label: "Size", value: { text: "{rows} rows × {columns} columns", values: { rows: 10, columns: 5 } } },
      ],
    })
    expect((await describe(TAB)).facts).toEqual([])
    expect(writesOf(h.requests)).toEqual([])
  })

  test("describes with Google's default for a size dimension left out, and throws for a taken title", async () => {
    const h = await writeFixture(handlers())
    const describe = (args: unknown) => googleSheetsTabAdd.describe!(googleSheetsTabAdd.input.parse(args), h.ctx)

    expect((await describe({ ...TAB, rows: 10 })).facts).toEqual([
      { label: "Size", value: { text: "{rows} rows × {columns} columns", values: { rows: 10, columns: 26 } } },
    ])
    expect((await toolError(Promise.resolve(describe({ ...TAB, title: "PLAN" })))).message).toContain('"Plan"')
  })
})
