import { z } from "zod"
import { columnLetters, gridRangeA1, quoteTab, type GridBounds } from "./a1"
import { dimensionOf, resolveRange, type DimensionRange, type ResolvedRange } from "./grid"
import { MAX_RANGE_LENGTH } from "./schemas"
import type { SheetTab } from "./tabs"

/** The most ranges one operation names, and the most a whole call names. */
export const MAX_OPERATION_RANGES = 500

/** How many of an operation's ranges its description shows before it counts the rest. */
const SHOWN_RANGES = 4

/** The operations that act on ranges name them with `range` or `ranges`. */
export type RangedOperation = { range?: string; ranges?: readonly string[] }

/** A range with the dimension (whole rows or whole columns) it covers. */
export type ResolvedDimension = ResolvedRange & { dimension: DimensionRange }

export const rangeText = z.string().min(1).max(MAX_RANGE_LENGTH)

/** The arguments an operation on ranges takes to name them; `hasOneRange` checks that exactly one is given. */
export const rangeFields = {
  range: rangeText
    .optional()
    .describe("One A1 range (`Plan!A1:F1`, `'My tab'!B:D`, `Plan!3:5`, or `A1` for the first tab)."),
  ranges: z
    .array(rangeText)
    .min(1)
    .max(MAX_OPERATION_RANGES)
    .optional()
    .describe(`Several A1 ranges in place of \`range\`, at most ${MAX_OPERATION_RANGES} in all across the call.`),
}

/** The message of an operation that names no range or both. */
export const ONE_RANGE_MESSAGE = "Give `range` or `ranges`, one of them."

/** Whether the operation names its ranges with exactly one of `range` and `ranges`. */
export function hasOneRange(op: RangedOperation): boolean {
  return (op.range === undefined) !== (op.ranges === undefined)
}

/** The A1 ranges the operation names; none for an operation that names tabs instead of ranges. */
export function rangesOf(op: RangedOperation | object): readonly string[] {
  const { range, ranges } = op as RangedOperation
  return ranges ?? (range === undefined ? [] : [range])
}

/** How many ranges the operation names. */
export function rangeCount(op: RangedOperation | object): number {
  return rangesOf(op).length
}

/** How many ranges the operations name in all. */
export function rangesIn(operations: readonly (RangedOperation | object)[]): number {
  return operations.reduce((total, op) => total + rangeCount(op), 0)
}

/** Each range of the operation with its tab and grid, refusing a range whose tab does not exist or whose cells are not A1. */
export function areasOf(op: RangedOperation | object, tabs: readonly SheetTab[]): ResolvedRange[] {
  return rangesOf(op).map((range) => resolveRange(tabs, range))
}

/** Each range of the operation as whole rows or whole columns, refusing any other block. */
export function dimensionsOf(op: RangedOperation | object, tabs: readonly SheetTab[]): ResolvedDimension[] {
  const ranges = rangesOf(op)
  return areasOf(op, tabs).map((area, position) => ({ ...area, dimension: dimensionOf(area.grid, ranges[position]!) }))
}

/** The tabs of the ranges, in the order of the ranges, each once. */
export function tabsOfAreas(areas: readonly ResolvedRange[]): SheetTab[] {
  return [...new Map(areas.map(({ tab }) => [tab.sheetId, tab])).values()]
}

/** A range in A1 notation with the tab's title Google reports; a single cell is `Plan!B2`, not `Plan!B2:B2`. */
export function areaLabel({ tab, grid }: { tab: Pick<SheetTab, "title">; grid: GridBounds }): string {
  const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = grid
  const single =
    startRowIndex !== undefined &&
    startColumnIndex !== undefined &&
    endRowIndex === startRowIndex + 1 &&
    endColumnIndex === startColumnIndex + 1
  return single
    ? `${quoteTab(tab.title)}!${columnLetters(startColumnIndex)}${startRowIndex + 1}`
    : gridRangeA1(tab.title, grid)
}

/** The ranges as a description shows them, in A1 notation with the tab's title Google reports: up to four, then how many more. */
export function rangesLabel(areas: readonly ResolvedRange[]): string {
  const shown = areas.slice(0, SHOWN_RANGES).map(areaLabel)
  const more = areas.length - SHOWN_RANGES
  return shown.join(", ") + (more > 0 ? ` +${more}` : "")
}
