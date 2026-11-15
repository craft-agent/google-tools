import { ToolError } from "../errors"

/** A spreadsheet's id as Google writes it. */
const ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/

/** A Google Sheets URL, whatever follows the id (a path, a query, a hash); the id is the first capture. */
const URL_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:[/?#].*)?$/

/** How much of a refused value an error repeats. */
const MAX_SHOWN_LENGTH = 100

/** The spreadsheet id of `value`, which is the id itself or a `https://docs.google.com/spreadsheets/d/<id>/…` URL; anything else is `invalid_argument`. */
export function spreadsheetId(value: string): string {
  if (ID_PATTERN.test(value)) return value
  const id = URL_PATTERN.exec(value)?.[1]
  if (id !== undefined) return id
  const shown = value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH)}…` : value
  throw new ToolError(
    "invalid_argument",
    `${JSON.stringify(shown)} is neither a spreadsheet id nor a Google Sheets URL.`,
  )
}
