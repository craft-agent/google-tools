import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BATCH_GET_URL, SPREADSHEET_ID, answer, callOf, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const VALUES = { method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A1:C2", "'My tab'!A:A"] }

const REPLY = {
  spreadsheetId: SPREADSHEET_ID,
  valueRanges: [
    {
      range: "Plan!A1:C2",
      majorDimension: "ROWS",
      values: [
        ["Name", "Qty", "Done"],
        ["Pens", 3, true],
      ],
    },
    { range: "'My tab'!A1:A1000", majorDimension: "ROWS" },
  ],
}

describe("google_sheets_read values", () => {
  test("returns each range's rows as Google resolved it, with none for an empty range", async () => {
    const h = await fixture([answer(BATCH_GET_URL, REPLY)])

    expect(await h.read(VALUES)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      ranges: [
        {
          range: "Plan!A1:C2",
          values: [
            ["Name", "Qty", "Done"],
            ["Pens", 3, true],
          ],
          rows: 2,
          truncated: false,
          clipped_cells: 0,
        },
        { range: "'My tab'!A1:A1000", values: [], rows: 0, truncated: false, clipped_cells: 0 },
      ],
    })
  })

  test("sends every range as a repeated ranges parameter, as rows, formatted by default", async () => {
    const h = await fixture([answer(BATCH_GET_URL, REPLY)])

    await h.read(VALUES)

    expect(h.calls().map(callOf)).toEqual([`GET ${BATCH_GET_URL}`])
    const { searchParams } = h.calls()[0]!.url
    expect(searchParams.getAll("ranges")).toEqual(["Plan!A1:C2", "'My tab'!A:A"])
    expect(searchParams.get("valueRenderOption")).toBe("FORMATTED_VALUE")
    expect(searchParams.get("majorDimension")).toBe("ROWS")
    expect(searchParams.has("dateTimeRenderOption")).toBe(false)
  })

  test.each([
    ["formatted", "FORMATTED_VALUE", null],
    ["unformatted", "UNFORMATTED_VALUE", "FORMATTED_STRING"],
    ["formula", "FORMULA", null],
  ])("render %s asks for %s", async (render, option, dateTime) => {
    const h = await fixture([answer(BATCH_GET_URL, REPLY)])

    await h.read({ ...VALUES, render })

    const { searchParams } = h.calls()[0]!.url
    expect(searchParams.get("valueRenderOption")).toBe(option)
    expect(searchParams.get("dateTimeRenderOption")).toBe(dateTime)
  })

  test("takes the spreadsheet's URL for its id", async () => {
    const h = await fixture([answer(BATCH_GET_URL, REPLY)])

    const result = await h.read({
      ...VALUES,
      spreadsheet: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=sharing`,
    })

    expect(result.spreadsheet_id).toBe(SPREADSHEET_ID)
    expect(h.calls().map(callOf)).toEqual([`GET ${BATCH_GET_URL}`])
  })

  test("a value that is no text, number or boolean is null; a range Google leaves unnamed keeps the one asked", async () => {
    const h = await fixture([answer(BATCH_GET_URL, { valueRanges: [{ values: [["x", { odd: 1 }, null]] }] })])

    expect((await h.read({ ...VALUES, ranges: ["Plan!A1:C1"] })).ranges).toEqual([
      { range: "Plan!A1:C1", values: [["x", null, null]], rows: 1, truncated: false, clipped_cells: 0 },
    ])
  })

  test.each([
    ["no ranges", { ranges: undefined }],
    ["an empty list of ranges", { ranges: [] }],
    ["an empty range", { ranges: [""] }],
    ["a range over 500 characters", { ranges: ["A".repeat(501)] }],
    ["more than 100 ranges", { ranges: Array.from({ length: 101 }, (_, i) => `A${i + 1}`) }],
    ["an unknown render", { render: "raw" }],
    ["no spreadsheet", { spreadsheet: undefined }],
    ["something that is no spreadsheet", { spreadsheet: "not a spreadsheet" }],
  ])("refuses %s before any request", async (_name, change) => {
    const h = await fixture([answer(BATCH_GET_URL, REPLY)])

    await expect(h.read({ ...VALUES, ...change })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
