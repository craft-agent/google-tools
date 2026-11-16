import { createHash } from "node:crypto"
import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { canonicalJson } from "../pin"
import { cellSchema, type Cell } from "./schemas"
import { budgeted, fetchValueRanges } from "./values"

/** A range as it was before a write, in the form `google_sheets_edit` takes to put it back. */
const beforeRangeSchema = z.object({
  /** The range as Google resolved it. */
  range: z.string(),
  values: z.array(z.array(cellSchema)),
})

type BeforeRange = z.infer<typeof beforeRangeSchema>

/** The `before` and `before_truncated` keys of the result of a write that replaces cells. */
export const beforeOutput = {
  before: z
    .array(beforeRangeSchema)
    .nullable()
    .describe(
      "The ranges as they were just before the call, formulas as written; give them back to google_sheets_edit as `data` to undo the change. Null when they did not fit (see `before_truncated`).",
    ),
  before_truncated: z
    .boolean()
    .describe(
      "True when `before` is null because the ranges hold more cells than a read returns, or a text cell longer than one returns; read them before changing anything like that.",
    ),
}

/** What a write that replaces cells replaces: the cells now in its ranges. */
export type Before = {
  /** The ranges for the result, or `null` when a read would have cut them. */
  ranges: BeforeRange[] | null
  /** How many cells hold something now, across all of every range. */
  occupied: number
  /** A hash of every value read, so a change anywhere in the ranges changes it. */
  digest: string
}

/** Whether the cell at zero-based `row` and `column` of a range, counted from its top-left cell, survives the write, so it is not counted as replaced. */
export type Keeps = (row: number, column: number) => boolean

/** Whether a cell Google returned holds something: an empty string is a cell with nothing in it. */
function isOccupied(cell: unknown): boolean {
  return cell !== undefined && cell !== null && cell !== ""
}

/** How many cells of the rows hold something and do not survive the write. */
function occupiedCells(rows: readonly (readonly unknown[])[], keeps: Keeps | undefined): number {
  return rows.reduce(
    (total, row, rowIndex) =>
      total + row.filter((cell, column) => isOccupied(cell) && !keeps?.(rowIndex, column)).length,
    0,
  )
}

/** A row as a write takes it: Google leaves an empty row empty, and a row of cells holds at least one. */
function writable(row: Cell[]): Cell[] {
  return row.length === 0 ? [""] : row
}

/**
 * Reads the ranges as their formulas, once, for a write that replaces them:
 * the values to hand back (the same budget as the read tool's `values`; `null`
 * when a range was cut or a text clipped, since a copy that is not whole must
 * not be mistaken for one), how many cells are occupied and a digest of
 * everything read. The prompt and the run both read with this function. A
 * range's `keeps` (by position in `ranges`) names the cells the write leaves
 * as they are, which are read but not counted as occupied; no range asks Google
 * for nothing.
 */
export async function readBefore(
  client: GoogleClient,
  id: string,
  ranges: readonly string[],
  keeps: readonly (Keeps | undefined)[] = [],
): Promise<Before> {
  const fetched = ranges.length === 0 ? [] : await fetchValueRanges(client, id, ranges, "formula")
  const read = budgeted(fetched)
  const whole = read.every((range) => !range.truncated && range.clipped_cells === 0)
  return {
    ranges: whole ? read.map(({ range, values }) => ({ range, values: values.map(writable) })) : null,
    occupied: fetched.reduce((total, { values }, position) => total + occupiedCells(values, keeps[position]), 0),
    digest: createHash("sha256").update(canonicalJson(fetched)).digest("hex"),
  }
}
