import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FORMAT = { method: "format", spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A1:Z1"] }
const LINK = "https://example.com"

/** A fake Google reply holding one row of cells. */
const reply = (...values: unknown[]) => ({
  sheets: [{ properties: { title: "Plan" }, data: [{ rowData: [{ values }] }] }],
})

describe("google_sheets_read format: rich-text runs", () => {
  test("reads rich_text's styled spans, omitting the plain reset and defaulting the first start to zero", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply({
          userEnteredValue: { stringValue: "Docs: see the guide" },
          textFormatRuns: [
            { format: { bold: true } },
            { startIndex: 6, format: {} },
            { startIndex: 10, format: { link: { uri: LINK }, foregroundColorStyle: { rgbColor: { blue: 1 } } } },
          ],
        }),
      ),
    ])

    const { formats } = await h.read(FORMAT)

    expect(formats![0]!.cells).toEqual([
      {
        cell: "A1",
        format: null,
        note: null,
        link: null,
        runs: [
          { start: 0, text: "Docs: ", bold: true },
          { start: 10, text: "the guide", link: LINK, color: "#0000ff" },
        ],
        validation: null,
      },
    ])
  })

  test("lists no plain resets, empty spans, unsupported styles, non-string values or unstyled text", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply(
          { userEnteredValue: { stringValue: "plain" }, textFormatRuns: [{ format: {} }] },
          {
            userEnteredValue: { stringValue: "empty" },
            textFormatRuns: [{ format: { bold: true } }, { startIndex: 0, format: {} }],
          },
          { userEnteredValue: { stringValue: "unknown" }, textFormatRuns: [{ format: { unknown: true } }] },
          { userEnteredValue: { numberValue: 12 }, textFormatRuns: [{ format: { bold: true } }] },
          { userEnteredValue: { stringValue: "private" } },
          { note: "kept" },
        ),
      ),
    ])

    const { formats } = await h.read(FORMAT)

    expect(formats![0]!.cells).toEqual([
      { cell: "F1", format: null, note: "kept", link: null, runs: null, validation: null },
    ])
  })

  test("maps all text styles, keeping false flags and preferring color styles over legacy colors", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply({
          userEnteredValue: { stringValue: "ab" },
          hyperlink: LINK,
          textFormatRuns: [
            {
              format: {
                bold: false,
                italic: true,
                underline: false,
                strikethrough: true,
                fontSize: 14,
                fontFamily: "Roboto",
                foregroundColorStyle: { themeColor: "ACCENT1" },
                foregroundColor: { red: 1 },
              },
            },
            { startIndex: 1, format: { foregroundColor: { green: 1 } } },
          ],
        }),
      ),
    ])

    const { formats } = await h.read(FORMAT)

    expect(formats![0]!.cells[0]!.link).toBe(LINK)
    expect(formats![0]!.cells[0]!.runs).toEqual([
      {
        start: 0,
        text: "a",
        bold: false,
        italic: true,
        underline: false,
        strikethrough: true,
        font_size: 14,
        font: "Roboto",
        color: "theme:ACCENT1",
      },
      { start: 1, text: "b", color: "#00ff00" },
    ])
  })

  test("cuts a crossing run and drops a later run at the 2,000-character budget", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply({
          userEnteredValue: { stringValue: "x".repeat(2100) },
          textFormatRuns: [
            { startIndex: 1990, format: { bold: true } },
            { startIndex: 2050, format: { italic: true } },
          ],
        }),
      ),
    ])

    const { formats } = await h.read(FORMAT)

    expect(formats![0]!.cells[0]!.runs).toEqual([{ start: 1990, text: "x".repeat(10), bold: true }])
    expect(formats![0]!.cells[0]!.runs_clipped).toBe(true)
  })

  test("drops a run starting exactly at the budget while retaining the cell's note", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply({
          note: "kept",
          userEnteredValue: { stringValue: "x".repeat(2100) },
          textFormatRuns: [{ startIndex: 2000, format: { bold: true } }],
        }),
      ),
    ])

    const { formats } = await h.read(FORMAT)

    expect(formats![0]!.cells[0]).toEqual({
      cell: "A1",
      format: null,
      note: "kept",
      link: null,
      runs: null,
      runs_clipped: true,
      validation: null,
    })
  })

  test("uses UTF-16 indexes after an emoji and does not mark a run ending at the budget as clipped", async () => {
    const h = await fixture([
      answer(
        SPREADSHEET_URL,
        reply(
          { userEnteredValue: { stringValue: "😀 bold" }, textFormatRuns: [{ startIndex: 3, format: { bold: true } }] },
          {
            userEnteredValue: { stringValue: "x".repeat(2100) },
            textFormatRuns: [{ format: { bold: true } }, { startIndex: 2000, format: {} }],
          },
        ),
      ),
    ])

    const { formats } = await h.read(FORMAT)
    const cells = formats![0]!.cells

    expect(cells[0]!.runs).toEqual([{ start: 3, text: "bold", bold: true }])
    expect(cells[1]!.runs).toEqual([{ start: 0, text: "x".repeat(2000), bold: true }])
    expect(cells.every((cell) => !("runs_clipped" in cell))).toBe(true)
  })
})
