import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { writeTargets } from "../targets"
import { googleSheetsCreate } from "./create"
import { SPREADSHEET_ID, SHEETS_CREDENTIAL, cleanUp, freshTokens } from "./read.testing"
import { CREATE_URL, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CREATED = {
  spreadsheetId: SPREADSHEET_ID,
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
  properties: { title: "Plan 2027" },
  sheets: [{ properties: { title: "Q1" } }, { properties: { sheetId: 12, title: "Q2", index: 1 } }],
}

describe("google_sheets_create", () => {
  test("sends the title and the tabs, and asks for the fields it returns", async () => {
    const h = await writeFixture([post(CREATE_URL, CREATED)])

    await h.create({ title: "Plan 2027", tabs: ["Q1", " Q2 "] })

    expect(h.names()).toEqual([`POST ${CREATE_URL}`])
    const [write] = writesOf(h.requests)
    expect(write!.json).toEqual({
      properties: { title: "Plan 2027" },
      sheets: [{ properties: { title: "Q1" } }, { properties: { title: "Q2" } }],
    })
    expect(write!.url.searchParams.get("fields")).toBe(
      "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index)",
    )
  })

  test("sends no sheets when no tabs are given", async () => {
    const h = await writeFixture([post(CREATE_URL, { ...CREATED, sheets: undefined })])

    const result = await h.create({ title: "Plan 2027" })

    expect(writesOf(h.requests)[0]!.json).toEqual({ properties: { title: "Plan 2027" } })
    expect(result.tabs).toEqual([])
  })

  test("returns the id, title, URL and tabs as Google reports them, a left-out 0 being 0", async () => {
    const h = await writeFixture([post(CREATE_URL, CREATED)])

    expect(await h.create({ title: "Plan 2027", tabs: ["Q1", "Q2"] })).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      title: "Plan 2027",
      url: CREATED.spreadsheetUrl,
      tabs: [
        { sheet_id: 0, title: "Q1", index: 0 },
        { sheet_id: 12, title: "Q2", index: 1 },
      ],
    })
  })

  test.each([
    ["tab titles that differ only in case", { title: "T", tabs: ["Q1", "q1"] }],
    ["a blank tab title", { title: "T", tabs: ["  "] }],
    ["an empty list of tabs", { title: "T", tabs: [] }],
    ["an empty title", { title: "" }],
    ["a title over 200 characters", { title: "x".repeat(201) }],
    ["more than 50 tabs", { title: "T", tabs: Array.from({ length: 51 }, (_, i) => `t${i}`) }],
    ["an unknown argument", { title: "T", folder: "x" }],
  ])("refuses %s before any request", async (_name, args) => {
    const h = await writeFixture([post(CREATE_URL, CREATED)])

    expect(googleSheetsCreate.input.safeParse(args).success).toBe(false)
    expect(h.requests).toEqual([])
  })

  test("fails for a label that cannot write before any request", async () => {
    const h = await writeFixture([post(CREATE_URL, CREATED)], SHEETS_CREDENTIAL)

    const error = await toolError(h.create({ title: "T" }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_create: targets, describe and bounds", () => {
  test("the target is the account's `spreadsheets/new`", async () => {
    const h = await writeFixture()

    expect(await writeTargets(googleSheetsCreate, { title: "T" }, h.ctx)).toEqual(["work/spreadsheets/new"])
    expect(await writeTargets(googleSheetsCreate, { title: "T", account: "work" }, h.ctx)).toEqual([
      "work/spreadsheets/new",
    ])
  })

  test("the target is `*` when the label cannot be told or cannot write", async () => {
    const none = await writeFixture([], null)
    const readOnly = await writeFixture([], SHEETS_CREDENTIAL)

    expect(await writeTargets(googleSheetsCreate, { title: "T" }, none.ctx)).toEqual(["*"])
    expect(await writeTargets(googleSheetsCreate, { title: "T" }, readOnly.ctx)).toEqual(["*"])
    expect(readOnly.requests).toEqual([])
  })

  test("describes the title from the argument and the tabs, with no text and no pins", async () => {
    const h = await writeFixture()
    const describe = (args: unknown) => googleSheetsCreate.describe!(googleSheetsCreate.input.parse(args), h.ctx)

    expect(await describe({ title: "Plan 2027", tabs: ["Q1", "Q2"] })).toEqual({
      headline: { text: "About to create the spreadsheet {title}", values: { title: "Plan 2027" } },
      facts: [{ label: "Tabs", value: "Q1, Q2" }],
    })
    expect((await describe({ title: "Plan 2027" })).facts).toEqual([])
    expect(h.requests).toEqual([])
  })

  test("measures the number of tabs, 0 when none", () => {
    const measure = (args: unknown) => googleSheetsCreate.measure!(googleSheetsCreate.input.parse(args), { cwd: "/" })

    expect(measure({ title: "T", tabs: ["a", "b", "c"] })).toEqual({ tabs: 3 })
    expect(measure({ title: "T" })).toEqual({ tabs: 0 })
  })
})
