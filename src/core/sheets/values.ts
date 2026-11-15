import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { Cell, ReadRange, Render, ValuesResult } from "./schemas"

/** The most cells one call returns, across all its ranges. */
export const MAX_CELLS = 10_000

/** The most characters of a text cell one call returns; a longer one is cut to this. */
export const MAX_CELL_LENGTH = 2_000

/** Google's name for each way of rendering a cell's value. */
const VALUE_RENDER_OPTIONS = {
  formatted: "FORMATTED_VALUE",
  unformatted: "UNFORMATTED_VALUE",
  formula: "FORMULA",
} as const satisfies Record<Render, string>

/** Dates and times of unformatted values come as the text the sheet shows, not as serial numbers. */
const DATE_TIME_RENDER_OPTION = "FORMATTED_STRING"

const MAJOR_DIMENSION = "ROWS"

const batchReply = z.object({
  valueRanges: z
    .array(z.object({ range: z.string().optional(), values: z.array(z.array(z.unknown())).optional() }))
    .optional(),
})

/** What one cell is returned as: text, a number or a boolean as it is, anything else `null`. */
function plainCell(value: unknown): Cell {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null
}

/** The first `MAX_CELL_LENGTH` characters of a longer text, never cutting a character in two. */
function clipText(text: string): string | undefined {
  if (text.length <= MAX_CELL_LENGTH) return undefined
  const characters = Array.from(text)
  return characters.length > MAX_CELL_LENGTH ? characters.slice(0, MAX_CELL_LENGTH).join("") : undefined
}

/** A row's share of the budget: its cells, and at least one, so a run of empty rows is not free. */
function rowCost(row: readonly unknown[]): number {
  return Math.max(row.length, 1)
}

/** The row's cells as returned, with the number of texts clipped. */
function readRow(row: readonly unknown[]): { cells: Cell[]; clipped: number } {
  let clipped = 0
  const cells = row.map((value) => {
    const cell = plainCell(value)
    const text = typeof cell === "string" ? clipText(cell) : undefined
    if (text === undefined) return cell
    clipped++
    return text
  })
  return { cells, clipped }
}

/** One range of a batch reply as Google returned it: the range it resolved (the one asked when it names none) and its rows, whole. */
export type FetchedRange = { range: string; values: unknown[][] }

/**
 * Applies one shared budget of `MAX_CELLS` cells to the ranges, in order.
 * A range keeps whole rows while they fit; at the first that does not, the
 * rest of the range and every range after it are dropped, and each range that
 * lost rows is `truncated`.
 */
export function budgeted(fetched: readonly FetchedRange[]): ReadRange[] {
  let remaining = MAX_CELLS
  return fetched.map((fetchedRange): ReadRange => {
    const rows = fetchedRange.values
    const kept: Cell[][] = []
    let clipped = 0
    for (const row of rows) {
      if (rowCost(row) > remaining) break
      remaining -= rowCost(row)
      const read = readRow(row)
      kept.push(read.cells)
      clipped += read.clipped
    }
    if (kept.length < rows.length) remaining = 0
    return {
      range: fetchedRange.range,
      values: kept,
      rows: rows.length,
      truncated: kept.length < rows.length,
      clipped_cells: clipped,
    }
  })
}

/** Reads the ranges in one batch call, with no budget applied: every row Google returns, in the order asked. */
export async function fetchValueRanges(
  client: GoogleClient,
  id: string,
  ranges: readonly string[],
  render: Render,
): Promise<FetchedRange[]> {
  const reply = parseReply(
    batchReply,
    await client.request(SHEETS_ROUTES.batchGet, {
      params: { spreadsheet_id: id },
      query: {
        ranges,
        valueRenderOption: VALUE_RENDER_OPTIONS[render],
        dateTimeRenderOption: render === "unformatted" ? DATE_TIME_RENDER_OPTION : undefined,
        majorDimension: MAJOR_DIMENSION,
      },
    }),
    "the values",
  )
  return (reply.valueRanges ?? []).map((valueRange, position) => ({
    range: valueRange.range ?? ranges[position] ?? "",
    values: valueRange.values ?? [],
  }))
}

/** The values of each range, as Google reports them (a range may resolve to another A1 form), within the call's cell budget. */
export async function readValues(
  client: GoogleClient,
  id: string,
  ranges: readonly string[],
  render: Render = "formatted",
): Promise<ValuesResult> {
  return { spreadsheet_id: id, ranges: budgeted(await fetchValueRanges(client, id, ranges, render)) }
}
