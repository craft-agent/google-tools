import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BATCH_GET_URL, SPREADSHEET_ID, answer, cleanUp, fixture, freshTokens } from "./read.testing"
import { MAX_CELL_LENGTH, MAX_CELLS } from "./values"

beforeEach(freshTokens)
afterEach(cleanUp)

const ROW_WIDTH = 100
const ROWS_PER_BUDGET = MAX_CELLS / ROW_WIDTH

/** Rows of `ROW_WIDTH` cells each. */
function rows(count: number, cell: string | number = "x"): (string | number)[][] {
  return Array.from({ length: count }, () => Array.from({ length: ROW_WIDTH }, () => cell))
}

async function readRanges(valueRanges: unknown[]) {
  const h = await fixture([answer(BATCH_GET_URL, { valueRanges })])
  const ranges = valueRanges.map((_, index) => `Tab${index}!A:Z`)
  return (await h.read({ method: "values", spreadsheet: SPREADSHEET_ID, ranges })).ranges ?? []
}

describe("google_sheets_read values: the cell budget", () => {
  test("a call that fits is returned whole", async () => {
    const [first] = await readRanges([{ range: "Tab0!A1:CV100", values: rows(ROWS_PER_BUDGET) }])

    expect(first).toMatchObject({ rows: ROWS_PER_BUDGET, truncated: false })
    expect(first?.values).toHaveLength(ROWS_PER_BUDGET)
  })

  test("the rest of a range is dropped once the budget runs out; rows stays Google's count", async () => {
    const [first] = await readRanges([{ range: "Tab0!A1:CV150", values: rows(ROWS_PER_BUDGET + 50) }])

    expect(first?.values).toHaveLength(ROWS_PER_BUDGET)
    expect(first).toMatchObject({ rows: ROWS_PER_BUDGET + 50, truncated: true })
  })

  test("the budget is shared in request order and every later range is dropped", async () => {
    const [first, second, third, empty] = await readRanges([
      { range: "Tab0!A1:CV60", values: rows(60) },
      { range: "Tab1!A1:CV60", values: rows(60) },
      { range: "Tab2!A1:CV5", values: rows(5) },
      { range: "Tab3!A1:CV1" },
    ])

    expect(first).toMatchObject({ range: "Tab0!A1:CV60", rows: 60, truncated: false })
    expect(first?.values).toHaveLength(60)
    expect(second).toMatchObject({ range: "Tab1!A1:CV60", rows: 60, truncated: true })
    expect(second?.values).toHaveLength(40)
    expect(third).toEqual({ range: "Tab2!A1:CV5", values: [], rows: 5, truncated: true, clipped_cells: 0 })
    expect(empty).toEqual({ range: "Tab3!A1:CV1", values: [], rows: 0, truncated: false, clipped_cells: 0 })
  })

  test("a range that uses the budget exactly leaves nothing for the next one", async () => {
    const [first, second] = await readRanges([
      { range: "Tab0!A1:CV100", values: rows(ROWS_PER_BUDGET) },
      { range: "Tab1!A1:CV1", values: rows(1) },
    ])

    expect(first).toMatchObject({ truncated: false })
    expect(second).toMatchObject({ values: [], rows: 1, truncated: true })
  })

  test("a row that does not fit whole is dropped, not cut", async () => {
    const [first] = await readRanges([{ range: "Tab0!A1:CV100", values: [...rows(99), ...rows(1), [1, 2, 3]] }])

    expect(first?.values).toHaveLength(100)
    const wide = await readRanges([{ range: "Tab0!A1:ZZ1", values: [Array.from({ length: MAX_CELLS + 1 }, () => 1)] }])
    expect(wide[0]).toMatchObject({ values: [], rows: 1, truncated: true })
  })

  test("an empty row counts as one cell, so blank rows cannot flood a result", async () => {
    const [first] = await readRanges([
      { range: "Tab0!A1:A20000", values: Array.from({ length: MAX_CELLS + 5 }, () => []) },
    ])

    expect(first?.values).toHaveLength(MAX_CELLS)
    expect(first).toMatchObject({ rows: MAX_CELLS + 5, truncated: true })
  })
})

describe("google_sheets_read values: long text", () => {
  test("a text longer than the limit is cut to it and counted", async () => {
    const [first] = await readRanges([
      { range: "Tab0!A1:C1", values: [["a".repeat(MAX_CELL_LENGTH + 1), "b".repeat(MAX_CELL_LENGTH), "short"]] },
    ])

    expect(first?.values[0]?.map((cell) => String(cell).length)).toEqual([MAX_CELL_LENGTH, MAX_CELL_LENGTH, 5])
    expect(first).toMatchObject({ clipped_cells: 1, truncated: false })
  })

  test("a cut never splits a character", async () => {
    const [first] = await readRanges([{ range: "Tab0!A1:A1", values: [["😀".repeat(MAX_CELL_LENGTH + 1)]] }])

    const cell = first?.values[0]?.[0] as string
    expect(Array.from(cell)).toHaveLength(MAX_CELL_LENGTH)
    expect(cell).toBe("😀".repeat(MAX_CELL_LENGTH))
    expect(first?.clipped_cells).toBe(1)
  })

  test("a text of the limit's length in characters is left whole even where it takes more code units", async () => {
    const [first] = await readRanges([{ range: "Tab0!A1:A1", values: [["😀".repeat(MAX_CELL_LENGTH)]] }])

    expect(first).toMatchObject({ clipped_cells: 0 })
  })

  test("only cells that are returned are counted as clipped", async () => {
    const long = "c".repeat(MAX_CELL_LENGTH + 10)
    const [first, second] = await readRanges([
      { range: "Tab0!A1:A1", values: [[long], ...rows(ROWS_PER_BUDGET)] },
      { range: "Tab1!A1:A1", values: [[long]] },
    ])

    expect(first?.clipped_cells).toBe(1)
    expect(second).toMatchObject({ values: [], truncated: true, clipped_cells: 0 })
  })
})
