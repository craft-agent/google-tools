import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { callDescription } from "../describe"
import { googleSheetsAppend } from "./append"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { appendUrl, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const RANGE = {
  spreadsheet: SPREADSHEET_ID,
  range: "Plan!A:C",
  values: [
    ["Pens", 3, true],
    ["Ink", null, ""],
  ],
}

const handlers = () => [metadata(), post(appendUrl("Plan!A:C"))]

const describing = async (args: unknown) => {
  const h = await writeFixture(handlers())
  return { h, description: await googleSheetsAppend.describe!(googleSheetsAppend.input.parse(args), h.ctx) }
}

describe("google_sheets_append: describe", () => {
  test("names the tab and the spreadsheet as Google reports them, counts the rows and cells, and shows the rows as written", async () => {
    const { description } = await describing(RANGE)

    expect(description).toEqual({
      headline: {
        text: "About to append {rows} rows to {tab} in {spreadsheet}",
        values: { rows: "2", tab: "Plan", spreadsheet: "Budget 2027" },
      },
      facts: [
        { label: "Rows", value: { text: "{count} rows", values: { count: 2 } } },
        { label: "Cells", value: { text: "{count} cells", values: { count: 6 } } },
      ],
      text: { label: "Rows", body: "Pens\t3\ttrue\nInk\t\t" },
    })
  })

  test("has its own headline for one row, and names the tab by its title whatever the range wrote", async () => {
    const { description } = await describing({ ...RANGE, range: "my tab!A1", values: [["x"]] })

    expect(description.headline).toEqual({
      text: "About to append a row to {tab} in {spreadsheet}",
      values: { tab: "My Tab", spreadsheet: "Budget 2027" },
    })
    expect(description.facts[0]).toEqual({ label: "Rows", value: { text: "{count} row", values: { count: 1 } } })
    expect(description.facts[1]).toEqual({ label: "Cells", value: { text: "{count} cell", values: { count: 1 } } })
  })

  test("names the table first, as Google reports it, when it appends to one", async () => {
    const { range: _range, ...rest } = RANGE
    const { description } = await describing({ ...rest, table: "orders", values: [["a"]] })

    expect(description.headline!.values).toEqual({ tab: "Plan", spreadsheet: "Budget 2027" })
    expect(description.facts[0]).toEqual({ label: "Table", value: "Orders" })
    expect(description.facts).toHaveLength(3)
  })

  test("pins nothing, reads only the tabs, and gives the same description twice", async () => {
    const first = await describing(RANGE)
    const second = await describing(RANGE)

    expect(first.description.pins).toBeUndefined()
    expect(second.description).toEqual(first.description)
    expect(first.h.names()).toEqual([`GET ${SPREADSHEET_URL}`])
    expect(writesOf(first.h.requests)).toEqual([])
  })

  test("is accepted by the description check", async () => {
    const h = await writeFixture(handlers())

    expect((await callDescription(googleSheetsAppend, RANGE, h.ctx))?.text?.body).toBe("Pens\t3\ttrue\nInk\t\t")
  })

  test("throws where the call would refuse: a slash in a tab title, an unknown tab and a table that is too narrow", async () => {
    const h = await writeFixture(handlers())
    const describe = (args: unknown) =>
      toolError(Promise.resolve(googleSheetsAppend.describe!(googleSheetsAppend.input.parse(args), h.ctx)))
    const { range: _range, ...rest } = RANGE

    expect((await describe({ ...RANGE, range: "'a/b'!A1" })).message).toContain("`/` cannot be appended to")
    expect((await describe({ ...RANGE, range: "Nope!A1" })).message).toContain("names no tab")
    expect((await describe({ ...rest, table: "Orders", values: [[1, 2, 3, 4]] })).message).toContain("has 3 columns")
    expect(await callDescription(googleSheetsAppend, { ...RANGE, range: "Nope!A1" }, h.ctx)).toBeUndefined()
  })
})
