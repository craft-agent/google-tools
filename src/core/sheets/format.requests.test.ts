import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { PLAN, send } from "./format.testing"
import { BATCH_UPDATE_URL } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const A1_F1 = PLAN({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 })

describe("google_sheets_format: format", () => {
  test("sets the properties given, and the mask names exactly those", async () => {
    const { body } = await send([{ op: "format", range: "Plan!A1:F1", bold: true, background: "#ffeeaa" }])

    expect(body).toEqual({
      requests: [
        {
          repeatCell: {
            range: A1_F1,
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColorStyle: { rgbColor: { red: 1, green: 0xee / 255, blue: 0xaa / 255 } },
              },
            },
            fields:
              "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle",
          },
        },
      ],
      includeSpreadsheetInResponse: false,
    })
  })

  test("writes every property in Google's words", async () => {
    const { body } = await send([
      {
        op: "format",
        range: "Plan!A1",
        italic: false,
        underline: true,
        strikethrough: true,
        font: "Roboto",
        font_size: 12,
        color: "#f00",
        horizontal_align: "center",
        vertical_align: "middle",
        wrap: "overflow",
        number_format: { type: "date_time", pattern: "yyyy-mm-dd" },
        rotation: "vertical",
        padding: { top: 2, left: 4 },
      },
    ])

    expect(body.requests).toEqual([
      {
        repeatCell: {
          range: PLAN({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }),
          cell: {
            userEnteredFormat: {
              textFormat: {
                italic: false,
                underline: true,
                strikethrough: true,
                fontSize: 12,
                fontFamily: "Roboto",
                foregroundColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
              },
              textRotation: { vertical: true },
              padding: { top: 2, right: 0, bottom: 0, left: 4 },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "OVERFLOW_CELL",
              numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd" },
            },
          },
          fields: [
            "textFormat.italic",
            "textFormat.underline",
            "textFormat.strikethrough",
            "textFormat.fontSize",
            "textFormat.fontFamily",
            "textFormat.foregroundColor",
            "textFormat.foregroundColorStyle",
            "textRotation",
            "padding",
            "horizontalAlignment",
            "verticalAlignment",
            "wrapStrategy",
            "numberFormat",
          ]
            .map((field) => `userEnteredFormat.${field}`)
            .join(","),
        },
      },
    ])
  })

  test("null clears a color by naming its fields and giving no value; a rotation is an angle", async () => {
    const { body } = await send([{ op: "format", range: "Plan!A1", color: null, background: null, rotation: -45 }])

    expect(body.requests).toEqual([
      {
        repeatCell: {
          range: PLAN({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }),
          cell: { userEnteredFormat: { textRotation: { angle: -45 } } },
          fields:
            "userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.foregroundColorStyle," +
            "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle,userEnteredFormat.textRotation",
        },
      },
    ])
  })

  test("reset clears every format first, then applies the properties; reset alone is one request", async () => {
    const both = await send([{ op: "format", range: "Plan!A1:F1", reset: true, italic: true }])
    const alone = await send([{ op: "format", range: "Plan!A1:F1", reset: true }])

    expect(both.body.requests).toEqual([
      { repeatCell: { range: A1_F1, cell: {}, fields: "userEnteredFormat" } },
      {
        repeatCell: {
          range: A1_F1,
          cell: { userEnteredFormat: { textFormat: { italic: true } } },
          fields: "userEnteredFormat.textFormat.italic",
        },
      },
    ])
    expect(alone.body.requests).toEqual([{ repeatCell: { range: A1_F1, cell: {}, fields: "userEnteredFormat" } }])
  })

  test("makes a request per range, in the order given, on the tab each names", async () => {
    const { body } = await send([{ op: "format", ranges: ["'My Tab'!B:B", "Plan!3:4"], bold: true }])

    expect(body.requests.map((request: any) => request.repeatCell.range)).toEqual([
      { sheetId: 77, startColumnIndex: 1, endColumnIndex: 2 },
      { sheetId: 0, startRowIndex: 2, endRowIndex: 4 },
    ])
  })
})

describe("google_sheets_format: borders", () => {
  test("draws every side in solid black by default, the sides sorted", async () => {
    const { body } = await send([{ op: "borders", range: "Plan!A1:F1" }])

    const border = { style: "SOLID", colorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } } }
    expect(body.requests).toEqual([
      {
        updateBorders: {
          range: A1_F1,
          bottom: border,
          innerHorizontal: border,
          innerVertical: border,
          left: border,
          right: border,
          top: border,
        },
      },
    ])
  })

  test("draws the sides given, as words or groups, in the style and color given", async () => {
    const { body } = await send([
      { op: "borders", range: "Plan!A1:F1", sides: ["top", "inner"], style: "dashed", color: "#00ff00" },
      { op: "borders", range: "Plan!A2:F2", sides: "outer", style: "solid_thick" },
    ])

    const green = { red: 0, green: 1, blue: 0 }
    expect(body.requests.map((request: any) => Object.keys(request.updateBorders).sort())).toEqual([
      ["innerHorizontal", "innerVertical", "range", "top"],
      ["bottom", "left", "range", "right", "top"],
    ])
    expect((body.requests[0] as any).updateBorders.top).toEqual({ style: "DASHED", colorStyle: { rgbColor: green } })
    expect((body.requests[1] as any).updateBorders.left.style).toBe("SOLID_THICK")
  })

  test("none removes every border with the style NONE and no color", async () => {
    const { body } = await send([{ op: "borders", range: "Plan!A1", sides: "none" }])

    const request = (body.requests[0] as any).updateBorders
    expect(request.top).toEqual({ style: "NONE" })
    expect(Object.keys(request).sort()).toEqual([
      "bottom",
      "innerHorizontal",
      "innerVertical",
      "left",
      "range",
      "right",
      "top",
    ])
  })
})

describe("google_sheets_format: the result", () => {
  test("sends one batch and returns what was applied, the requests and the tabs changed left to right", async () => {
    const { h, result } = await send([
      { op: "format", range: "'My Tab'!A1:F1", bold: true, background: "#ffeeaa" },
      { op: "freeze", rows: 1 },
      { op: "hide", ranges: ["Plan!B:B", "Plan!D:D"] },
    ])

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${BATCH_UPDATE_URL}`])
    expect(result).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      applied: ["format 'My Tab'!A1:F1 bold, background #ffeeaa", "freeze Plan rows 1", "hide Plan!B:B, Plan!D:D"],
      requests: 4,
      tabs: ["Plan", "My Tab"],
    })
  })
})
