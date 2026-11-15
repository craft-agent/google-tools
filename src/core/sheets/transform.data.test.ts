import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS } from "./structure.testing"
import { refusedTransform, sendTransform } from "./transform.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const column = (startIndex: number) => ({ sheetId: 0, dimension: "COLUMNS", startIndex, endIndex: startIndex + 1 })

describe("google_sheets_transform: sort", () => {
  test("sorts the rows below the header by the keys, the first taking precedence", async () => {
    const { requests, result } = await sendTransform([
      { op: "sort", range: "Plan!A1:D20", by: [{ column: "c", order: "desc" }, { column: "B" }] },
    ])

    expect(requests).toEqual([
      {
        sortRange: {
          range: PLAN_GRID(1, 20, 0, 4),
          sortSpecs: [
            { dimensionIndex: 2, sortOrder: "DESCENDING" },
            { dimensionIndex: 1, sortOrder: "ASCENDING" },
          ],
        },
      },
    ])
    expect(result.applied).toEqual(["sort Plan!A1:D20 by C desc, B asc, row 1 stays as the header"])
    expect(result.results).toEqual([{ op: "sort" }])
  })

  test("sorts the first row too with `header: false`", async () => {
    const { requests, result } = await sendTransform([
      { op: "sort", range: "Plan!A1:D20", by: [{ column: "A" }], header: false },
    ])

    expect(requests).toEqual([
      { sortRange: { range: PLAN_GRID(0, 20, 0, 4), sortSpecs: [{ dimensionIndex: 0, sortOrder: "ASCENDING" }] } },
    ])
    expect(result.applied).toEqual(["sort Plan!A1:D20 by A asc"])
  })

  test.each([
    ["a block with an open end", { range: "Plan!A2:D", by: [{ column: "A" }] }, "closed block"],
    ["whole columns", { range: "Plan!A:D", by: [{ column: "A" }] }, "closed block"],
    ["a key column outside the range", { range: "Plan!A1:D20", by: [{ column: "E" }] }, "column E is outside"],
    ["a range of the header row alone", { range: "Plan!A1:D1", by: [{ column: "A" }] }, "only its header row"],
  ])("refuses %s, and writes nothing", async (_name, op, message) => {
    const error = await refusedTransform([{ op: "sort", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("takes 1 to 10 keys", async () => {
    const keys = (count: number) => Array.from({ length: count }, () => ({ column: "A" }))

    expect((await refusedTransform([{ op: "sort", range: "Plan!A1:D20", by: [] }])).code).toBe("invalid_argument")
    expect((await refusedTransform([{ op: "sort", range: "Plan!A1:D20", by: keys(11) }])).code).toBe("invalid_argument")
    expect((await sendTransform([{ op: "sort", range: "Plan!A1:D20", by: keys(10) }])).requests).toHaveLength(1)
  })
})

describe("google_sheets_transform: dedupe", () => {
  test("deletes the rows below the header that repeat an earlier one, comparing the columns named", async () => {
    const { requests, result } = await sendTransform([{ op: "dedupe", range: "Plan!A1:D10", compare: ["a", "C"] }], {
      reply: { replies: [{ deleteDuplicates: { duplicatesRemovedCount: 4 } }] },
    })

    expect(requests).toEqual([
      { deleteDuplicates: { range: PLAN_GRID(1, 10, 0, 4), comparisonColumns: [column(0), column(2)] } },
    ])
    expect(result.applied).toEqual(["dedupe Plan!A1:D10 by A, C, the first of each stays, row 1 stays as the header"])
    expect(result.results).toEqual([{ op: "dedupe", duplicates_removed: 4 }])
  })

  test("compares every column when none is named, and counts none when Google leaves the count out", async () => {
    const { requests, result } = await sendTransform([{ op: "dedupe", range: "Plan!A1:D10", header: false }], {
      reply: { replies: [{ deleteDuplicates: {} }] },
    })

    expect(requests).toEqual([{ deleteDuplicates: { range: PLAN_GRID(0, 10, 0, 4), comparisonColumns: [] } }])
    expect(result.results).toEqual([{ op: "dedupe", duplicates_removed: 0 }])
  })

  test("refuses a column outside the range and an open range", async () => {
    const outside = await refusedTransform([{ op: "dedupe", range: "Plan!A1:D10", compare: ["E"] }])
    const open = await refusedTransform([{ op: "dedupe", range: "Plan!A:D" }])

    expect(outside.message).toContain("compare column E is outside")
    expect(open.message).toContain("closed block")
  })
})

describe("google_sheets_transform: trim", () => {
  test("trims each range and sums the cells Google changed", async () => {
    const { requests, result } = await sendTransform([{ op: "trim", ranges: ["Plan!A1:B2", "'My Tab'!C3:C9"] }], {
      reply: { replies: [{ trimWhitespace: { cellsChangedCount: 3 } }, { trimWhitespace: { cellsChangedCount: 2 } }] },
    })

    expect(requests).toEqual([
      { trimWhitespace: { range: PLAN_GRID(0, 2, 0, 2) } },
      {
        trimWhitespace: {
          range: { sheetId: 77, startRowIndex: 2, endRowIndex: 9, startColumnIndex: 2, endColumnIndex: 3 },
        },
      },
    ])
    expect(result.results).toEqual([{ op: "trim", cells_changed: 5 }])
    expect(result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("refuses whole columns, and names exactly one of `range` and `ranges`", async () => {
    expect((await refusedTransform([{ op: "trim", range: "Plan!A:A" }])).message).toContain("closed block")
    expect((await refusedTransform([{ op: "trim", range: "Plan!A1:B2", ranges: ["Plan!C1:C2"] }])).code).toBe(
      "invalid_argument",
    )
    expect((await refusedTransform([{ op: "trim" }])).code).toBe("invalid_argument")
  })
})

describe("google_sheets_transform: split_text", () => {
  test.each([
    [undefined, { delimiterType: "AUTODETECT" }, "the detected separator"],
    ["Semicolon", { delimiterType: "SEMICOLON" }, "semicolon"],
    [" ", { delimiterType: "SPACE" }, "space"],
    ["|", { delimiterType: "CUSTOM", delimiter: "|" }, '"|"'],
  ])("splits on %p", async (delimiter, request, shown) => {
    const { requests, result } = await sendTransform([
      { op: "split_text", range: "Plan!A2:A50", ...(delimiter !== undefined && { delimiter }) },
    ])

    expect(requests).toEqual([{ textToColumns: { source: PLAN_GRID(1, 50, 0, 1), ...request } }])
    expect(result.applied).toEqual([`split_text Plan!A2:A50 on ${shown} into the columns to its right`])
  })

  test.each([
    ["a range of two columns", { range: "Plan!A2:B50" }, "takes one column"],
    ["an open range", { range: "Plan!A2:A" }, "closed block"],
    ["a delimiter of several characters that is no word", { range: "Plan!A2:A50", delimiter: "ab" }, "one character"],
  ])("refuses %s", async (_name, op, message) => {
    const error = await refusedTransform([{ op: "split_text", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("reads the tab's size, so what it overwrites reaches the tab's last column", async () => {
    const { h } = await sendTransform([{ op: "split_text", range: "Plan!B2:B50" }], { spreadsheet: WITH_OBJECTS })

    const reads = h.calls().filter((request) => request.url.pathname.endsWith("batchGet"))
    expect(reads.at(-1)!.url.searchParams.getAll("ranges")).toEqual(["Plan!B2:J50"])
  })
})

describe("google_sheets_transform: autofill", () => {
  test.each([
    ["down", "Plan!A1:A2", 3, { dimension: "ROWS", fillLength: 3 }, "Plan!A3:A5"],
    ["up", "Plan!A5:B6", 2, { dimension: "ROWS", fillLength: -2 }, "Plan!A3:B4"],
    ["right", "Plan!A1:B2", 4, { dimension: "COLUMNS", fillLength: 4 }, "Plan!C1:F2"],
    ["left", "Plan!D1:E2", 2, { dimension: "COLUMNS", fillLength: -2 }, "Plan!B1:C2"],
  ])("fills %s from %s", async (direction, range, fill, axis, filled) => {
    const { requests, result } = await sendTransform([{ op: "autofill", range, fill, direction }])

    const source = (requests[0] as any).autoFill.sourceAndDestination.source
    expect(requests).toEqual([{ autoFill: { useAlternateSeries: false, sourceAndDestination: { source, ...axis } } }])
    expect(result.applied).toEqual([`autofill ${direction} from ${range} into ${filled}`])
  })

  test("fills down by default", async () => {
    const { requests } = await sendTransform([{ op: "autofill", range: "Plan!A1:A2", fill: 1 }])

    expect(requests[0]).toMatchObject({ autoFill: { sourceAndDestination: { dimension: "ROWS", fillLength: 1 } } })
  })

  test.each([
    ["a fill that runs past the first row", { range: "Plan!A1:A2", fill: 1, direction: "up" }, "past the first row"],
    ["an open range", { range: "Plan!A1:A", fill: 1 }, "closed block"],
    ["a fill of none", { range: "Plan!A1:A2", fill: 0 }, ""],
    ["a fill of more than 10,000", { range: "Plan!A1:A2", fill: 10_001 }, ""],
  ])("refuses %s", async (_name, op, message) => {
    const error = await refusedTransform([{ op: "autofill", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})
