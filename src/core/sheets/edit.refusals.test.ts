import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID, SPREADSHEET_URL, SHEETS_CREDENTIAL, cleanUp, freshTokens } from "./read.testing"
import { UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const ITEM = { range: "Plan!A1", values: [["x"]] }
const EDIT = { spreadsheet: SPREADSHEET_ID, data: [ITEM] }

const row = (cells: number) => Array.from({ length: cells }, () => 1)

describe("google_sheets_edit: arguments", () => {
  test.each([
    ["no data", { data: [] }],
    ["more than 500 ranges", { data: Array.from({ length: 501 }, () => ITEM) }],
    ["an item with no range", { data: [{ values: [["x"]] }] }],
    ["an empty range", { data: [{ range: "", values: [["x"]] }] }],
    ["an item with no rows", { data: [{ range: "Plan!A1", values: [] }] }],
    ["an empty row", { data: [{ range: "Plan!A1", values: [["x"], []] }] }],
    ["a cell that is not text, a number or a boolean", { data: [{ range: "Plan!A1", values: [[{ a: 1 }]] }] }],
    ["an unknown key in an item", { data: [{ ...ITEM, note: "x" }] }],
    ["an unknown argument", { note: "x" }],
    ["a spreadsheet that is none", { spreadsheet: "not a spreadsheet" }],
    ["no spreadsheet", { spreadsheet: undefined }],
  ])("refuses %s before any request", async (_name, change) => {
    const h = await writeFixture([metadata()])

    await expect(h.edit({ ...EDIT, ...change })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("refuses more than 10000 cells in all, counted over every range, and takes exactly 10000", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(UPDATE_URL)])

    const error = await toolError(
      h.edit({
        ...EDIT,
        data: [
          { range: "Plan!A1", values: [row(5_000)] },
          { range: "Plan!A2", values: [row(5_001)] },
        ],
      }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("data: holds more than 10000 cells in all")
    expect(h.requests).toEqual([])

    await h.edit({ ...EDIT, data: [{ range: "Plan!A1", values: [row(10_000)] }] })
    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("a range that names no tab is refused after the metadata, listing the tabs, with nothing written", async () => {
    const h = await writeFixture([metadata(), post(UPDATE_URL)])

    const error = await toolError(h.edit({ ...EDIT, data: [{ range: "Nope!A1", values: [["x"]] }] }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("names no tab")
    expect(error.message).toContain("Plan, My Tab, a/b")
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`])
  })

  test("a range that is not A1 notation is refused", async () => {
    const h = await writeFixture([metadata(), post(UPDATE_URL)])

    await expect(h.edit({ ...EDIT, data: [{ range: "'Plan!A1", values: [["x"]] }] })).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("not a range in A1 notation"),
    })
    expect(writesOf(h.requests)).toEqual([])
  })

  test("a label that only reads is unauthenticated, naming the login that adds the write scope, before any request", async () => {
    const h = await writeFixture([metadata()], SHEETS_CREDENTIAL)

    const error = await toolError(h.edit(EDIT))

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("login --account work --toolsets account,sheets")
    expect(error.message).not.toContain("--read-only")
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_edit: Google's refusals", () => {
  test("a write Google refuses is its error, after the before was read", async () => {
    const h = await writeFixture([
      metadata(),
      valuesHandler(() => []),
      {
        method: "POST",
        url: UPDATE_URL,
        reply: {
          status: 400,
          json: { error: { code: 400, message: "Range exceeds grid limits", status: "INVALID_ARGUMENT" } },
        },
      },
    ])

    await expect(h.edit(EDIT)).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("Range exceeds grid limits"),
    })
  })
})
