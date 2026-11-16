import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PIN_PATTERN } from "../pin"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS } from "./structure.testing"
import { describeTransform, refusedTransform, sendTransform } from "./transform.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The read of grid data (the notes of ranges) as Google answers it: the notes of the cells of one row, `null` for a cell with none. */
const notesReply = (...notes: (string | null)[]) => ({
  sheets: [{ data: [{ rowData: [{ values: notes.map((note) => (note === null ? {} : { note })) }] }] }],
})

describe("google_sheets_transform: note", () => {
  test("sets the note of each range, trimmed", async () => {
    const { requests, result } = await sendTransform([
      { op: "note", ranges: ["Plan!B2", "'My Tab'!A1:A3"], text: "  Check this \n" },
    ])

    expect(requests).toEqual([
      { repeatCell: { range: PLAN_GRID(1, 2, 1, 2), cell: { note: "Check this" }, fields: "note" } },
      {
        repeatCell: {
          range: { sheetId: 77, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { note: "Check this" },
          fields: "note",
        },
      },
    ])
    expect(result.applied).toEqual(["note Plan!B2, 'My Tab'!A1:A3 \"Check this\""])
    expect(result.before).toEqual([])
  })

  test("removes the notes with an empty text, over whole columns too", async () => {
    const { requests, result } = await sendTransform([{ op: "note", range: "Plan!C:C", text: "" }], {
      spreadsheet: WITH_OBJECTS,
    })

    expect(requests).toEqual([
      { repeatCell: { range: { sheetId: 0, startColumnIndex: 2, endColumnIndex: 3 }, cell: {}, fields: "note" } },
    ])
    expect(result.applied).toEqual(["note Plan!C:C remove"])
  })

  test("names one of `range` and `ranges`, and a text", async () => {
    expect((await refusedTransform([{ op: "note", text: "x" }])).code).toBe("invalid_argument")
    expect((await refusedTransform([{ op: "note", range: "Plan!A1" }])).code).toBe("invalid_argument")
  })

  test("pins the notes the ranges hold now, read with the note field mask, and loses no value", async () => {
    const first = await describeTransform([{ op: "note", range: "Plan!A1:B1", text: "new" }], {
      notes: notesReply("old", null),
    })
    const same = await describeTransform([{ op: "note", range: "Plan!A1:B1", text: "new" }], {
      notes: notesReply("old", null),
    })
    const changed = await describeTransform([{ op: "note", range: "Plan!A1:B1", text: "new" }], {
      notes: notesReply("edited", null),
    })

    expect(first.description.pins).toEqual({
      values: expect.stringMatching(PIN_PATTERN),
      notes: expect.stringMatching(PIN_PATTERN),
    })
    expect(same.description.pins).toEqual(first.description.pins)
    expect(changed.description.pins!.notes).not.toBe(first.description.pins!.notes)
    expect(changed.description.pins!.values).toBe(first.description.pins!.values)
    expect(first.description.facts[0]).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 0 } },
    })
    const read = first.h.calls().find((request) => request.url.searchParams.has("includeGridData"))!
    expect(read.url.searchParams.get("fields")).toBe("sheets.data.rowData.values.note")
    expect(read.url.searchParams.getAll("ranges")).toEqual(["Plan!A1:B1"])
  })

  test("pins no notes for a call that has no note operation", async () => {
    const { description } = await describeTransform([{ op: "trim", range: "Plan!A1:B2" }])

    expect(Object.keys(description.pins!)).toEqual(["values"])
  })

  test("refuses ranges of more than 10,000 cells, which cannot be read, and writes nothing", async () => {
    const error = await refusedTransform([{ op: "note", range: "Plan!A1:Z1000", text: "x" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("10000 cells")
  })
})

describe("google_sheets_transform: rich_text", () => {
  const BOLD = { bold: true }

  test("counts the start indexes in UTF-16 units, a character outside the BMP being two", async () => {
    const { requests, result } = await sendTransform([
      { op: "rich_text", range: "Plan!B2", value: "😀 Total: 5", runs: [{ text: "Total", bold: true }] },
    ])

    expect(requests).toEqual([
      {
        updateCells: {
          range: PLAN_GRID(1, 2, 1, 2),
          fields: "userEnteredValue,textFormatRuns",
          rows: [
            {
              values: [
                {
                  userEnteredValue: { stringValue: "😀 Total: 5" },
                  textFormatRuns: [
                    { startIndex: 3, format: BOLD },
                    { startIndex: 8, format: {} },
                  ],
                },
              ],
            },
          ],
        },
      },
    ])
    expect(result.applied).toEqual(['rich_text Plan!B2 with text "😀 Total: 5": "Total" bold'])
    expect(result.before).toEqual([{ range: "Plan!B2:B2", values: [] }])
  })

  test("places each run on the first occurrence of its text that no earlier run covers", async () => {
    const { requests } = await sendTransform([
      {
        op: "rich_text",
        range: "Plan!B2",
        value: "aa a",
        runs: [
          { text: "a", bold: true },
          { text: "a", italic: true },
          { text: "a", underline: true },
        ],
      },
    ])

    const [{ updateCells }] = requests as any[]
    expect(updateCells.rows[0].values[0].textFormatRuns).toEqual([
      { startIndex: 0, format: BOLD },
      { startIndex: 1, format: { italic: true } },
      { startIndex: 2, format: {} },
      { startIndex: 3, format: { underline: true } },
    ])
  })

  test("writes every style a run takes in Google's words, and leaves the text before the first run unstyled", async () => {
    const { requests } = await sendTransform([
      {
        op: "rich_text",
        range: "Plan!B2",
        value: "see docs",
        runs: [
          {
            text: "docs",
            bold: false,
            font_size: 12,
            font: "Roboto",
            color: "#ff0000",
            link: "https://example.com/docs",
          },
        ],
      },
    ])

    const [{ updateCells }] = requests as any[]
    expect(updateCells.rows[0].values[0].textFormatRuns).toEqual([
      {
        startIndex: 4,
        format: {
          bold: false,
          fontSize: 12,
          fontFamily: "Roboto",
          foregroundColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
          link: { uri: "https://example.com/docs" },
        },
      },
    ])
  })

  test("restyles the plain text the cell holds when no value is given, reading it as written", async () => {
    const { requests, h } = await sendTransform(
      [{ op: "rich_text", range: "Plan!B2", runs: [{ text: "Total", italic: true }] }],
      { rows: (range) => (range === "Plan!B2:B2" ? [["Total: 5"]] : []) },
    )

    const reads = h.calls().filter((request) => request.url.pathname.endsWith("batchGet"))
    expect(reads[0]!.url.searchParams.getAll("ranges")).toEqual(["Plan!B2:B2"])
    expect(reads[0]!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    const [{ updateCells }] = requests as any[]
    expect(updateCells.rows[0].values[0]).toEqual({
      userEnteredValue: { stringValue: "Total: 5" },
      textFormatRuns: [
        { startIndex: 0, format: { italic: true } },
        { startIndex: 5, format: {} },
      ],
    })
  })

  test.each([
    ["a number", [[42]]],
    ["a formula", [["=A1"]]],
    ["a boolean", [[true]]],
    ["an empty cell", []],
    ["an empty text", [[""]]],
  ])("refuses to restyle a cell that holds %s without a value", async (_name, rows) => {
    const error = await refusedTransform([{ op: "rich_text", range: "Plan!B2", runs: [{ text: "x", bold: true }] }], {
      rows: () => rows,
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("holds no plain text")
    expect(error.message).toContain("give `value`")
  })

  test.each([
    [
      "a run whose text is not in the cell",
      { value: "abc", runs: [{ text: "zz", bold: true }] },
      "is not in the cell's text",
    ],
    ["a run with no style", { value: "abc", runs: [{ text: "a" }] }, ""],
    ["no runs", { value: "abc", runs: [] }, ""],
    ["more than 50 runs", { value: "abc", runs: Array.from({ length: 51 }, () => ({ text: "a", bold: true })) }, ""],
    ["a link that is no address", { value: "abc", runs: [{ text: "a", link: "javascript:alert(1)" }] }, ""],
    ["a color that is no color", { value: "abc", runs: [{ text: "a", color: "red" }] }, ""],
    ["an empty value", { value: "", runs: [{ text: "a", bold: true }] }, ""],
  ])("refuses %s", async (_name, op, message) => {
    const error = await refusedTransform([{ op: "rich_text", range: "Plan!B2", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("takes one closed cell", async () => {
    const runs = [{ text: "a", bold: true }]

    expect((await refusedTransform([{ op: "rich_text", range: "Plan!B2:C2", value: "a", runs }])).message).toContain(
      "takes one cell",
    )
    expect((await refusedTransform([{ op: "rich_text", range: "Plan!B:B", value: "a", runs }])).message).toContain(
      "closed block",
    )
  })

  test("refuses a restyling without a value after an operation of the call that rewrites cells of its tab", async () => {
    const runs = [{ text: "x", bold: true }]
    const rows = () => [["x"]]

    const error = await refusedTransform(
      [
        { op: "sort", range: "Plan!A1:D9", by: [{ column: "A" }] },
        { op: "rich_text", range: "Plan!B2", runs },
      ],
      { rows },
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Operation 2 (rich_text)")
    expect(error.message).toContain("operation 1 (sort)")
    for (const operations of [
      [
        { op: "sort", range: "Plan!A1:D9", by: [{ column: "A" }] },
        { op: "rich_text", range: "Plan!B2", runs, value: "x" },
      ],
      [
        { op: "sort", range: "'My Tab'!A1:D9", by: [{ column: "A" }] },
        { op: "rich_text", range: "Plan!B2", runs },
      ],
      [
        { op: "note", range: "Plan!B2", text: "n" },
        { op: "rich_text", range: "Plan!B2", runs },
      ],
    ]) {
      expect((await sendTransform(operations, { rows })).requests).toHaveLength(2)
    }
  })
})
