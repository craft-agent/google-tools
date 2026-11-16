import { ToolError } from "../errors"
import { splitRange, type GridBounds } from "./a1"
import { shownRange, tabOfRange, type SheetTab } from "./tabs"

const ALPHABET_SIZE = 26
const FIRST_LETTER_CODE = "A".charCodeAt(0)

/** The cells of a range: a cell or block (`B2:D9`, `A2:C` with an open end), whole columns (`B:D`, `B`) or whole rows (`3:5`, `3`). */
const CELLS_PATTERN = /^([A-Za-z]{0,3})(\d{0,9})(?::([A-Za-z]{0,3})(\d{0,9}))?$/

/** A grid range as Google takes it: the tab's id and the zero-based, end-exclusive bounds; a bound left out is open (a start left out is 0). */
export type GridRange = GridBounds & { sheetId: number }

/** The rows or the columns of a tab as Google's dimension requests take them: zero-based, end-exclusive. */
export type DimensionRange = { sheetId: number; dimension: "ROWS" | "COLUMNS"; startIndex: number; endIndex: number }

/** An A1 range with the tab it lies in and the grid it covers. */
export type ResolvedRange = { tab: SheetTab; grid: GridRange }

/** The zero-based index of a column's letters: `A` is 0, `Z` is 25, `AA` is 26. */
export function columnIndex(letters: string): number {
  let index = 0
  for (const letter of letters.toUpperCase()) {
    index = index * ALPHABET_SIZE + (letter.charCodeAt(0) - FIRST_LETTER_CODE + 1)
  }
  return index - 1
}

/** The two numbers in ascending order. */
function ascending(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a]
}

/** The bounds of the cells of a range; `{}` for none, which is the whole tab. */
function cellBounds(cells: string, range: string): GridBounds {
  if (cells === "") return {}
  const match = CELLS_PATTERN.exec(cells.replaceAll("$", ""))
  const [, firstColumn = "", firstRow = "", lastColumn = firstColumn, lastRow = firstRow] = match ?? []
  const valid =
    match !== null &&
    (firstColumn !== "" || firstRow !== "") &&
    (lastColumn !== "" || lastRow !== "") &&
    (firstColumn === "") === (lastColumn === "") &&
    !firstRow.startsWith("0") &&
    !lastRow.startsWith("0")
  if (!valid) {
    throw new ToolError("invalid_argument", `The cells of ${JSON.stringify(shownRange(range))} are not in A1 notation.`)
  }
  const bounds: GridBounds = {}
  if (firstColumn !== "") {
    const [first, last] = ascending(columnIndex(firstColumn), columnIndex(lastColumn))
    bounds.startColumnIndex = first
    bounds.endColumnIndex = last + 1
  }
  if (firstRow !== "" && lastRow !== "") {
    const [first, last] = ascending(Number(firstRow), Number(lastRow))
    bounds.startRowIndex = first - 1
    bounds.endRowIndex = last
  } else if (firstRow !== "") {
    bounds.startRowIndex = Number(firstRow) - 1
  } else if (lastRow !== "") {
    bounds.startRowIndex = 0
    bounds.endRowIndex = Number(lastRow)
  }
  return bounds
}

/**
 * Resolves an A1 range against the tabs: the tab it names (the first tab for
 * cells with no tab, as `tabOfRange` does) and the grid it covers. `A2:C`
 * leaves the bottom open; `A:C` and `3:5` are whole columns and whole rows; a
 * tab's name alone is the whole tab. Anything else is `invalid_argument`.
 */
export function resolveRange(tabs: readonly SheetTab[], range: string): ResolvedRange {
  const tab = tabOfRange(tabs, range)
  const cells = splitRange(range)?.cells ?? ""
  return { tab, grid: { sheetId: tab.sheetId, ...cellBounds(cells, range) } }
}

/** The grid range of an A1 range, as `resolveRange` reads it. */
export function gridRange(tabs: readonly SheetTab[], range: string): GridRange {
  return resolveRange(tabs, range).grid
}

/** The dimension range of whole rows or whole columns of `grid`; any other block, or the whole tab, is `invalid_argument` naming `range`. */
export function dimensionOf(grid: GridRange, range: string): DimensionRange {
  const { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = grid
  if (startColumnIndex === undefined && endColumnIndex === undefined) {
    if (startRowIndex !== undefined && endRowIndex !== undefined) {
      return { sheetId, dimension: "ROWS", startIndex: startRowIndex, endIndex: endRowIndex }
    }
  } else if (startRowIndex === undefined && endRowIndex === undefined) {
    if (startColumnIndex !== undefined && endColumnIndex !== undefined) {
      return { sheetId, dimension: "COLUMNS", startIndex: startColumnIndex, endIndex: endColumnIndex }
    }
  }
  throw new ToolError(
    "invalid_argument",
    `${JSON.stringify(shownRange(range))} must be whole rows (\`Plan!3:5\`) or whole columns (\`Plan!B:D\`).`,
  )
}

/** The dimension range of an A1 range of whole rows (`3:5` is rows 2 to 5) or whole columns (`B:D` is columns 1 to 4). */
export function dimensionRange(tabs: readonly SheetTab[], range: string): DimensionRange {
  return dimensionOf(gridRange(tabs, range), range)
}
