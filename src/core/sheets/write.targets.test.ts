import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isAbortError } from "../errors"
import { writeTargets } from "../targets"
import { googleSheetsAppend } from "./append"
import { googleSheetsClear } from "./clear"
import { googleSheetsEdit } from "./edit"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { metadata, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}/sheets`

const item = (range: string) => ({ range, values: [["x"]] })

const edit = (...ranges: string[]) => ({ spreadsheet: SPREADSHEET_ID, data: ranges.map(item) })

describe("the Sheets writes' targets", () => {
  test("an edit names each distinct tab it writes to once, sorted, a range with no tab being the first tab", async () => {
    const h = await writeFixture([metadata()])

    const targets = await googleSheetsEdit.targets!(
      googleSheetsEdit.input.parse(edit("'My Tab'!A1", "Plan!B2", "C3", "my tab!D4", "'a/b'!A1")),
      h.ctx,
    )

    expect(targets).toEqual([`${BASE}/0`, `${BASE}/5`, `${BASE}/77`])
  })

  test("a clear names the tabs of its ranges", async () => {
    const h = await writeFixture([metadata()])

    const targets = await googleSheetsClear.targets!(
      googleSheetsClear.input.parse({ spreadsheet: SPREADSHEET_ID, ranges: ["'My Tab'!A:A", "Plan"] }),
      h.ctx,
    )

    expect(targets).toEqual([`${BASE}/0`, `${BASE}/77`])
  })

  test("an append names the tab of its range, or of its table", async () => {
    const h = await writeFixture([metadata()])
    const range = googleSheetsAppend.input.parse({ spreadsheet: SPREADSHEET_ID, range: "'My Tab'!A:C", values: [[1]] })
    const table = googleSheetsAppend.input.parse({ spreadsheet: SPREADSHEET_ID, table: "orders", values: [[1]] })

    expect(await googleSheetsAppend.targets!(range, h.ctx)).toEqual([`${BASE}/77`])
    expect(await googleSheetsAppend.targets!(table, h.ctx)).toEqual([`${BASE}/0`])
  })

  test("reach a permission rule as they are, sorted", async () => {
    const h = await writeFixture([metadata()])

    expect(await writeTargets(googleSheetsEdit, edit("'My Tab'!A1", "Plan!A1"), h.ctx)).toEqual([
      `${BASE}/0`,
      `${BASE}/77`,
    ])
  })

  test.each([
    ["a tab the spreadsheet lacks", edit("Plan!A1", "Nope!A1")],
    ["a range that is not A1 notation", edit("'Plan!A1")],
    ["a spreadsheet that is none", { ...edit("Plan!A1"), spreadsheet: "not a spreadsheet" }],
  ])("are `*` for %s", async (_name, args) => {
    const h = await writeFixture([metadata()])

    expect(await writeTargets(googleSheetsEdit, args, h.ctx)).toEqual(["*"])
  })

  test("are `*` for a table that is not there, and for a range with a slash in an append", async () => {
    const h = await writeFixture([metadata()])

    expect(
      await writeTargets(googleSheetsAppend, { spreadsheet: SPREADSHEET_ID, table: "Nope", values: [[1]] }, h.ctx),
    ).toEqual(["*"])
    expect(
      await writeTargets(googleSheetsAppend, { spreadsheet: SPREADSHEET_ID, range: "'a/b'!A1", values: [[1]] }, h.ctx),
    ).toEqual(["*"])
  })

  test("are `*` when there is no label", async () => {
    const h = await writeFixture([metadata()], null)

    expect(await writeTargets(googleSheetsEdit, edit("Plan!A1"), h.ctx)).toEqual(["*"])
  })

  test("are `*` when Google fails", async () => {
    const h = await writeFixture([
      {
        method: "GET",
        url: SPREADSHEET_URL,
        reply: { status: 500, json: { error: { code: 500, message: "Down", status: "INTERNAL" } } },
      },
    ])

    expect(await writeTargets(googleSheetsEdit, edit("Plan!A1"), h.ctx)).toEqual(["*"])
  })

  test("are `*` for a label that cannot write, before any request", async () => {
    const h = await writeFixture([metadata()], SHEETS_CREDENTIAL)

    expect(await writeTargets(googleSheetsEdit, edit("Plan!A1"), h.ctx)).toEqual(["*"])
    expect(h.requests).toEqual([])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const h = await writeFixture([metadata()])
    const controller = new AbortController()
    controller.abort()

    const error = await writeTargets(googleSheetsEdit, edit("Plan!A1"), { ...h.ctx, signal: controller.signal }).catch(
      (caught) => caught,
    )

    expect(isAbortError(error)).toBe(true)
  })
})
