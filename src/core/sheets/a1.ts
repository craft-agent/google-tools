import { ToolError } from "../errors"

/** The letters in the alphabet; a column's name is its index written in this base, with no zero digit. */
const ALPHABET_SIZE = 26
const FIRST_LETTER_CODE = "A".charCodeAt(0)

/** A tab title that A1 notation takes without quotes: letters, digits and `_`, not starting with a digit. */
const PLAIN_TITLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** What reads as a cell (`A1`) or as R1C1 notation (`R1C1`, `RC`, `R`, `C`), which a bare title must not look like. */
const CELL_LIKE_PATTERN = /^(?:[A-Z]{1,3}\d+|R\d*C\d*|[RC])$/i

/** A single-quoted tab title (inner quotes doubled), optionally followed by `!` and the cells. */
const QUOTED_TAB_PATTERN = /^'((?:[^']|'')*)'(?:!(.*))?$/s

const COLUMN = "\\$?[A-Za-z]{1,3}"
const ROW = "\\$?[0-9]+"
const CELL = `${COLUMN}${ROW}`

/** Cells written with no tab: a cell, a cell up to a cell or column (`A1:C`), whole columns or whole rows. A bare word is a tab. */
const BARE_CELLS_PATTERN = new RegExp(`^(?:${CELL}(?::(?:${CELL}|${COLUMN}))?|${COLUMN}:${COLUMN}|${ROW}:${ROW})$`)

/** A range split into the tab it names, unquoted (none for cells with no tab), and the cells after it (none for a tab alone). */
export type RangeParts = { tab: string | undefined; cells: string }

/** The zero-based, end-exclusive bounds of a grid range, as Google's `GridRange` gives them; a bound left out is open (a start left out is 0). */
export type GridBounds = {
  startRowIndex?: number
  endRowIndex?: number
  startColumnIndex?: number
  endColumnIndex?: number
}

/** Whether the two blocks of a tab share a cell; a bound left open reaches the end of the tab. */
export function boundsOverlap(a: GridBounds, b: GridBounds): boolean {
  const apart = (aStart = 0, aEnd = Infinity, bStart = 0, bEnd = Infinity) => aEnd <= bStart || bEnd <= aStart
  return (
    !apart(a.startRowIndex, a.endRowIndex, b.startRowIndex, b.endRowIndex) &&
    !apart(a.startColumnIndex, a.endColumnIndex, b.startColumnIndex, b.endColumnIndex)
  )
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
 * Splits an A1 range into its tab and its cells: `'My Tab'!A1:C` gives the tab
 * `My Tab` and the cells `A1:C`, `Plan!B2` the tab `Plan`, `A1:C3` no tab and a
 * bare word or a quoted title alone (`Plan`, `'Q1'`) a tab and no cells. It
 * gives `undefined` for a range with an unclosed or stray quote or an empty tab.
 */
export function splitRange(range: string): RangeParts | undefined {
  if (range.startsWith("'")) {
    const match = QUOTED_TAB_PATTERN.exec(range)
    if (match === null || match[1] === "") return undefined
    return { tab: (match[1] ?? "").replaceAll("''", "'"), cells: match[2] ?? "" }
  }
  const bang = range.indexOf("!")
  if (bang >= 0) return bang === 0 ? undefined : { tab: range.slice(0, bang), cells: range.slice(bang + 1) }
  return BARE_CELLS_PATTERN.test(range) ? { tab: undefined, cells: range } : { tab: range, cells: "" }
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
