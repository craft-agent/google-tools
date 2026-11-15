import { z } from "zod"
import { cellSchema, type Cell } from "./schemas"

/** The most cells one write call carries, counted as the sum of its rows' lengths. */
export const MAX_WRITE_CELLS = 10_000

/** Rows of cells; `null` and `""` write nothing into their cell, and a row holds at least one cell. */
export const rowsSchema = z.array(z.array(cellSchema).min(1)).min(1)

/** The `raw` argument of the tools that write cell values. */
export const rawArg = z
  .boolean()
  .optional()
  .describe(
    "true: store every value as given, so `=SUM(A1:A2)` stays text and `3/4` is not turned into a date. Default false: values are read as if typed into the sheet, so formulas run and numbers and dates are recognised.",
  )

/** How Google reads a written value: as given, or as if typed into the sheet. */
export function valueInputOption(raw: boolean | undefined): "RAW" | "USER_ENTERED" {
  return raw === true ? "RAW" : "USER_ENTERED"
}

/** The cells of the rows: the sum of their lengths. */
export function countCells(rows: readonly (readonly Cell[])[]): number {
  return rows.reduce((total, row) => total + row.length, 0)
}

/** The issue `refine` reports for a call whose `argument` carries more than `MAX_WRITE_CELLS` cells. */
export function cellLimitIssue(argument: string): { error: string; path: string[] } {
  return {
    error: `holds more than ${MAX_WRITE_CELLS} cells in all (the sum of its rows' lengths); split the call.`,
    path: [argument],
  }
}
