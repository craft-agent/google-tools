import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { callDescription } from "../describe"
import { PIN_PATTERN } from "../pin"
import { googleSheetsClear } from "./clear"
import { googleSheetsEdit } from "./edit"
import { BATCH_GET_URL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { metadata, post, UPDATE_URL, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const EDIT = {
  spreadsheet: SPREADSHEET_ID,
  data: [
    {
      range: "Plan!A1:B2",
      values: [
        ["Name", "Qty"],
        ["Pens", 3],
      ],
    },
  ],
}

const CLEAR = { spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A1:B3"] }

/** Two of the cells now in the ranges hold something. */
const CURRENT = [["Old", ""], [null, "=A1"], []]

const handlers = (current: unknown[][] = CURRENT) => [metadata(), valuesHandler(() => current), post(UPDATE_URL)]

describe("google_sheets_edit: describe", () => {
  test("names the spreadsheet by its title, shows the facts that decide first, the rows as written, and pins the values", async () => {
    const h = await writeFixture(handlers())

    const description = await googleSheetsEdit.describe!(googleSheetsEdit.input.parse(EDIT), h.ctx)

    expect(description).toEqual({
      headline: {
        text: "About to overwrite {range} in {spreadsheet}",
        values: { range: "Plan!A1:B2", spreadsheet: "Budget 2027" },
      },
      facts: [
        { label: "Overwrites", value: { text: "{count} cells", values: { count: 2 } } },
        { label: "Checks", value: { text: "none" } },
        { label: "Tabs", value: "Plan" },
        { label: "Cells", value: { text: "{count} cells", values: { count: 4 } } },
      ],
      text: { label: "Rows", body: "Plan!A1:B2\nName\tQty\nPens\t3" },
      pins: { values: expect.stringMatching(PIN_PATTERN) },
    })
  })

  test("counts the cells that hold something now, a zero and a false among them", async () => {
    const h = await writeFixture(handlers([[0, false, "", null], ["a"]]))

    const description = await googleSheetsEdit.describe!(googleSheetsEdit.input.parse(EDIT), h.ctx)

    expect(description.facts[0]).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 3 } },
    })
    const single = await writeFixture(handlers([["a"]]))
    expect((await googleSheetsEdit.describe!(googleSheetsEdit.input.parse(EDIT), single.ctx)).facts[0]!.value).toEqual({
      text: "{count} cell",
      values: { count: 1 },
    })
  })

  test("counts the checks, and names the ranges, the tabs by their titles in order, and a block of rows for each range", async () => {
    const h = await writeFixture(handlers())

    const description = await googleSheetsEdit.describe!(
      googleSheetsEdit.input.parse({
        ...EDIT,
        data: [{ range: "my tab!A1", values: [["a", "b"]] }, ...EDIT.data, { range: "B2", values: [[true, null]] }],
        expect: [{ range: "Plan!A1", value: "Name" }],
      }),
      h.ctx,
    )

    expect(description.headline).toEqual({
      text: "About to overwrite {ranges} ranges in {spreadsheet}",
      values: { ranges: "3", spreadsheet: "Budget 2027" },
    })
    expect(description.facts.slice(1)).toEqual([
      { label: "Checks", value: { text: "{count} check", values: { count: 1 } } },
      { label: "Tabs", value: "Plan, My Tab" },
      { label: "Cells", value: { text: "{count} cells", values: { count: 8 } } },
    ])
    expect(description.text).toEqual({
      label: "Rows",
      body: "my tab!A1\na\tb\n\nPlan!A1:B2\nName\tQty\nPens\t3\n\nB2\ntrue\t",
    })
  })

  test("reads the tabs and the current cells as formulas, and sends no write", async () => {
    const h = await writeFixture(handlers())

    await googleSheetsEdit.describe!(googleSheetsEdit.input.parse(EDIT), h.ctx)

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${BATCH_GET_URL}`])
    expect(h.calls()[1]!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("gives the same description for the same state, and another pin when a cell in the ranges changed", async () => {
    const args = googleSheetsEdit.input.parse(EDIT)
    const first = await googleSheetsEdit.describe!(args, (await writeFixture(handlers())).ctx)
    const again = await googleSheetsEdit.describe!(args, (await writeFixture(handlers())).ctx)
    const changed = await googleSheetsEdit.describe!(
      args,
      (await writeFixture(handlers([["Old", ""], [null, "=A2"], []]))).ctx,
    )

    expect(again).toEqual(first)
    expect(changed.pins!.values).not.toBe(first.pins!.values)
    expect(changed.facts).toEqual(first.facts)
  })

  test("pins a change past the cells a read would return", async () => {
    const rows = (last: string) => [...Array.from({ length: 10_001 }, () => ["x"]), [last]]
    const args = googleSheetsEdit.input.parse(EDIT)

    const first = await googleSheetsEdit.describe!(args, (await writeFixture(handlers(rows("a")))).ctx)
    const changed = await googleSheetsEdit.describe!(args, (await writeFixture(handlers(rows("b")))).ctx)

    expect(changed.pins!.values).not.toBe(first.pins!.values)
  })

  test("is accepted by the description check", async () => {
    const h = await writeFixture(handlers())

    const answer = await callDescription(googleSheetsEdit, EDIT, h.ctx)

    expect(answer?.pins?.values).toMatch(PIN_PATTERN)
    expect(answer?.facts).toHaveLength(4)
  })

  test("throws where the call would refuse: a tab that does not exist gives no description", async () => {
    const h = await writeFixture(handlers())
    const args = { ...EDIT, data: [{ range: "Nope!A1", values: [["x"]] }] }

    const error = await toolError(
      Promise.resolve(googleSheetsEdit.describe!(googleSheetsEdit.input.parse(args), h.ctx)),
    )

    expect(error.code).toBe("invalid_argument")
    expect(await callDescription(googleSheetsEdit, args, h.ctx)).toBeUndefined()
  })
})

describe("google_sheets_clear: describe", () => {
  test("names the range, shows what it overwrites and checks, and lists the ranges as the text", async () => {
    const h = await writeFixture(handlers())

    expect(await googleSheetsClear.describe!(googleSheetsClear.input.parse(CLEAR), h.ctx)).toEqual({
      headline: {
        text: "About to clear {range} in {spreadsheet}",
        values: { range: "Plan!A1:B3", spreadsheet: "Budget 2027" },
      },
      facts: [
        { label: "Overwrites", value: { text: "{count} cells", values: { count: 2 } } },
        { label: "Checks", value: { text: "none" } },
        { label: "Tabs", value: "Plan" },
      ],
      text: { label: "Ranges", body: "Plan!A1:B3" },
      pins: { values: expect.stringMatching(PIN_PATTERN) },
    })
  })

  test("counts the ranges for several, with one range per line", async () => {
    const h = await writeFixture(handlers())

    const description = await googleSheetsClear.describe!(
      googleSheetsClear.input.parse({
        ...CLEAR,
        ranges: ["Plan!A1", "'My Tab'!B:B"],
        expect: [{ range: "A1", value: 1 }],
      }),
      h.ctx,
    )

    expect(description.headline).toEqual({
      text: "About to clear {ranges} ranges in {spreadsheet}",
      values: { ranges: "2", spreadsheet: "Budget 2027" },
    })
    expect(description.facts[1]).toEqual({ label: "Checks", value: { text: "{count} check", values: { count: 1 } } })
    expect(description.facts[2]).toEqual({ label: "Tabs", value: "Plan, My Tab" })
    expect(description.text).toEqual({ label: "Ranges", body: "Plan!A1\n'My Tab'!B:B" })
  })

  test("pins the values now in the ranges, and throws for a tab that does not exist", async () => {
    const args = googleSheetsClear.input.parse(CLEAR)
    const first = await googleSheetsClear.describe!(args, (await writeFixture(handlers())).ctx)
    const changed = await googleSheetsClear.describe!(args, (await writeFixture(handlers([["New"]]))).ctx)

    expect(changed.pins!.values).not.toBe(first.pins!.values)
    const h = await writeFixture(handlers())
    await expect(
      Promise.resolve(
        googleSheetsClear.describe!(googleSheetsClear.input.parse({ ...CLEAR, ranges: ["Nope"] }), h.ctx),
      ),
    ).rejects.toMatchObject({ code: "invalid_argument" })
  })
})
