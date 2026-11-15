import { ToolError } from "../errors"

/** The letters in the alphabet; a column's name is its index written in this base, with no zero digit. */
const ALPHABET_SIZE = 26
const FIRST_LETTER_CODE = "A".charCodeAt(0)

/** A tab title that A1 notation takes without quotes: letters, digits and `_`, not starting with a digit. */
const PLAIN_TITLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** What reads as a cell (`A1`) or as R1C1 notation (`R1C1`, `RC`, `R`, `C`), which a bare title must not look like. */
const CELL_LIKE_PATTERN = /^(?:[A-Z]{1,3}\d+|R\d*C\d*|[RC])$/i

/** The zero-based, end-exclusive bounds of a grid range, as Google's `GridRange` gives them; a bound left out is open (a start left out is 0). */
export type GridBounds = {
  startRowIndex?: number
  endRowIndex?: number
  startColumnIndex?: number
  endColumnIndex?: number
}

/** The column's letters for a zero-based index: 0 is `A`, 25 is `Z`, 26 is `AA`. */
export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new ToolError("internal_error", `A column index must be a whole number from 0; got ${String(index)}.`)
  }
  let letters = ""
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / ALPHABET_SIZE)) {
    letters = String.fromCharCode(FIRST_LETTER_CODE + ((rest - 1) % ALPHABET_SIZE)) + letters
  }
  return letters
}

/** The tab's title as A1 notation names it: in single quotes, with inner quotes doubled, unless it is a plain name that does not look like a cell. */
export function quoteTab(title: string): string {
  if (PLAIN_TITLE_PATTERN.test(title) && !CELL_LIKE_PATTERN.test(title)) return title
  return `'${title.replaceAll("'", "''")}'`
}

/**
 * The A1 range of a grid range on the tab `title`: `Tab!A1:C10` when both
 * dimensions are bounded, whole columns (`Tab!A:C`) when only columns are,
 * whole rows (`Tab!1:5`) when only rows are, and the quoted title alone for the
 * whole tab. An end left open stays empty (`Tab!A2:C`).
 */
export function gridRangeA1(title: string, bounds: GridBounds = {}): string {
  const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = bounds
  const tab = quoteTab(title)
  const rowsBounded = startRowIndex !== undefined || endRowIndex !== undefined
  const columnsBounded = startColumnIndex !== undefined || endColumnIndex !== undefined
  if (!rowsBounded && !columnsBounded) return tab

  const firstRow = String((startRowIndex ?? 0) + 1)
  const lastRow = endRowIndex === undefined ? "" : String(endRowIndex)
  const firstColumn = columnLetters(startColumnIndex ?? 0)
  const lastColumn = endColumnIndex === undefined ? "" : columnLetters(endColumnIndex - 1)

  if (!rowsBounded) return `${tab}!${firstColumn}:${lastColumn}`
  if (!columnsBounded) return `${tab}!${firstRow}:${lastRow}`
  return `${tab}!${firstColumn}${firstRow}:${lastColumn}${lastRow}`
}
