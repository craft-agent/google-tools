import { ToolError } from "../errors"
import type { GridBounds } from "./a1"
import { resolveRange, type ResolvedRange } from "./grid"
import { rangesOf, type RangedOperation } from "./operation-ranges"
import { shownRange, type SheetTab } from "./tabs"

/** The bounds of a block that has all four corners: a start and an end on each axis. */
export type ClosedGrid = Required<GridBounds> & { sheetId: number }

/** A block of a tab with all four corners. */
export type ClosedArea = { tab: SheetTab; grid: ClosedGrid }

/** How many rows and columns a block spans. */
export type BlockSize = { rows: number; columns: number }

/** The range as a closed block, or `invalid_argument` naming the operation that needs one. */
function closedBlock(area: ResolvedRange, range: string, name: string): ClosedArea {
  const { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = area.grid
  if (
    startRowIndex === undefined ||
    endRowIndex === undefined ||
    startColumnIndex === undefined ||
    endColumnIndex === undefined
  ) {
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(shownRange(range))} must be a closed block with both corners, such as \`Plan!A1:D20\`, for ${name}.`,
    )
  }
  return { tab: area.tab, grid: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } }
}

/** Each range of the operation as a closed block, refusing a range that leaves an end open (whole rows or columns, a whole tab, `A2:C`). */
export function closedAreasOf(op: RangedOperation | object, tabs: readonly SheetTab[], name: string): ClosedArea[] {
  return rangesOf(op).map((range) => closedBlock(resolveRange(tabs, range), range, name))
}

/** The one range of an operation that takes a single `range`, as a closed block. */
export function onlyClosedArea(op: { range: string }, tabs: readonly SheetTab[], name: string): ClosedArea {
  return closedAreasOf(op, tabs, name)[0]!
}

/** The area as one cell, refusing a range of more cells or one with an open end; `what` names the argument that gave it. */
export function singleCell({ tab, grid }: ResolvedRange, what: string): ClosedArea {
  const { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = grid
  if (
    startRowIndex === undefined ||
    startColumnIndex === undefined ||
    endRowIndex !== startRowIndex + 1 ||
    endColumnIndex !== startColumnIndex + 1
  ) {
    throw new ToolError("invalid_argument", `\`${what}\` is one cell, such as \`Report!A1\`.`)
  }
  return { tab, grid: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } }
}

/** The block of `rows` by `columns` cells whose top-left cell is at the zero-based `top` and `left` of the tab `sheetId`. */
export function blockAt(sheetId: number, top: number, left: number, { rows, columns }: BlockSize): ClosedGrid {
  return {
    sheetId,
    startRowIndex: top,
    endRowIndex: top + rows,
    startColumnIndex: left,
    endColumnIndex: left + columns,
  }
}

/** How many rows and columns the block spans. */
export function sizeOf({ startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }: ClosedGrid): BlockSize {
  return { rows: endRowIndex - startRowIndex, columns: endColumnIndex - startColumnIndex }
}
