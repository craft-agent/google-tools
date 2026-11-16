import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID } from "./structure.testing"
import { refusedTransform, sendTransform } from "./transform.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A block of the tab `My Tab` (id 77) as Google's `GridRange`. */
const MY_TAB_GRID = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
  sheetId: 77,
  startRowIndex,
  endRowIndex,
  startColumnIndex,
  endColumnIndex,
})

describe("google_sheets_transform: copy", () => {
  test("copies the block to a destination of its size, on another tab", async () => {
    const { requests, result } = await sendTransform([{ op: "copy", range: "Plan!A1:B3", to: "'My Tab'!D5" }])

    expect(requests).toEqual([
      {
        copyPaste: {
          source: PLAN_GRID(0, 3, 0, 2),
          destination: MY_TAB_GRID(4, 7, 3, 5),
          pasteType: "PASTE_NORMAL",
          pasteOrientation: "NORMAL",
        },
      },
    ])
    expect(result.applied).toEqual(["copy Plan!A1:B3 to 'My Tab'!D5:E7"])
    expect(result.tabs).toEqual(["My Tab"])
  })

  test("turns the destination's rows and columns when transposed", async () => {
    const { requests, result } = await sendTransform([{ op: "copy", range: "Plan!A1:B3", to: "E1", transpose: true }])

    expect(requests).toEqual([
      {
        copyPaste: {
          source: PLAN_GRID(0, 3, 0, 2),
          destination: PLAN_GRID(0, 2, 4, 7),
          pasteType: "PASTE_NORMAL",
          pasteOrientation: "TRANSPOSE",
        },
      },
    ])
    expect(result.applied).toEqual(["copy Plan!A1:B3 to Plan!E1:G2 transposed"])
  })

  test("keeps a destination with no tab on the tab of the range", async () => {
    const { requests } = await sendTransform([{ op: "copy", range: "'My Tab'!A1:B2", to: "D1" }])

    expect(requests[0]).toMatchObject({ copyPaste: { destination: MY_TAB_GRID(0, 2, 3, 5) } })
  })

  test.each([
    ["all", "PASTE_NORMAL"],
    ["values", "PASTE_VALUES"],
    ["format", "PASTE_FORMAT"],
    ["no_borders", "PASTE_NO_BORDERS"],
    ["formulas", "PASTE_FORMULA"],
    ["input_rules", "PASTE_DATA_VALIDATION"],
    ["conditional", "PASTE_CONDITIONAL_FORMATTING"],
  ])("puts down %s as %s", async (paste, pasteType) => {
    const { requests, result } = await sendTransform([{ op: "copy", range: "Plan!A1:A1", to: "C3", paste }])

    expect(requests[0]).toMatchObject({ copyPaste: { pasteType } })
    expect(result.applied[0]).toBe(`copy Plan!A1 to Plan!C3${paste === "all" ? "" : ` (paste ${paste})`}`)
  })

  test.each([
    ["a source with an open end", { range: "Plan!A1:B", to: "E1" }, "closed block"],
    ["a destination that is a block", { range: "Plan!A1:B2", to: "E1:F2" }, "top-left cell"],
    ["a destination that is a whole tab", { range: "Plan!A1:B2", to: "'My Tab'" }, "top-left cell"],
    ["a destination on a tab the spreadsheet lacks", { range: "Plan!A1:B2", to: "Nope!E1" }, "names no tab"],
    ["an unknown paste", { range: "Plan!A1:B2", to: "E1", paste: "everything" }, ""],
  ])("refuses %s", async (_name, op, message) => {
    const error = await refusedTransform([{ op: "copy", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_transform: cut", () => {
  test("moves the block's values to the destination cell", async () => {
    const { requests, result } = await sendTransform([
      { op: "cut", range: "Plan!A1:B2", to: "'My Tab'!D1", paste: "values" },
    ])

    expect(requests).toEqual([
      {
        cutPaste: {
          source: PLAN_GRID(0, 2, 0, 2),
          destination: { sheetId: 77, rowIndex: 0, columnIndex: 3 },
          pasteType: "PASTE_VALUES",
        },
      },
    ])
    expect(result.applied).toEqual(["cut Plan!A1:B2 to 'My Tab'!D1:E2 (paste values)"])
    expect(result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("takes no `transpose`", async () => {
    const error = await refusedTransform([{ op: "cut", range: "Plan!A1:B2", to: "E1", transpose: true }])

    expect(error.code).toBe("invalid_argument")
  })

  test("returns the source and the destination as they were, each read once", async () => {
    const { result, h } = await sendTransform([{ op: "cut", range: "Plan!A1:B2", to: "D1" }], {
      rows: (range) => (range === "Plan!A1:B2" ? [["a", "b"], ["c"]] : [["x"]]),
    })

    const reads = h.calls().filter((request) => request.url.pathname.endsWith("batchGet"))
    expect(reads.at(-1)!.url.searchParams.getAll("ranges")).toEqual(["Plan!A1:B2", "Plan!D1:E2"])
    expect(result.before).toEqual([
      { range: "Plan!A1:B2", values: [["a", "b"], ["c"]] },
      { range: "Plan!D1:E2", values: [["x"]] },
    ])
    expect(result.before_truncated).toBe(false)
  })

  test("refuses a destination that is not one cell", async () => {
    const error = await refusedTransform([{ op: "cut", range: "Plan!A1:B2", to: "D:D" }])

    expect(error.message).toContain("top-left cell")
  })
})
