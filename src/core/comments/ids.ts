import { driveId } from "../drive/ids"
import { ToolError } from "../errors"

/**
 * The URL of a file in one of the Google editors or of a file in Drive,
 * whatever follows the id (a path, a query, a hash); the id is the first capture.
 */
const URL_PATTERN =
  /^https:\/\/(?:docs\.google\.com\/(?:document|spreadsheets|presentation|drawings|forms)|drive\.google\.com\/file)\/d\/([A-Za-z0-9_-]{1,200})(?:[/?#].*)?$/

/** A comment's or reply's id: Google writes them as opaque URL-safe strings. */
const COMMENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/

/** How much of a refused value an error repeats. */
const MAX_SHOWN_LENGTH = 100

/** `value` as an error repeats it: clipped to `MAX_SHOWN_LENGTH`, in quotes. */
function shown(value: string): string {
  return JSON.stringify(value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH)}…` : value)
}

/**
 * The file id of `value`, which is the id itself or the URL of a Google Docs,
 * Sheets, Slides, Drawings or Forms file or of a Drive file
 * (`https://docs.google.com/document/d/<id>/…`, `https://drive.google.com/file/d/<id>/…`);
 * anything else is `invalid_argument`.
 */
export function commentFileId(value: string): string {
  try {
    return driveId(URL_PATTERN.exec(value)?.[1] ?? value, "file id")
  } catch {
    throw new ToolError("invalid_argument", `${shown(value)} is neither a file id nor a Google file URL.`)
  }
}

/**
 * `value` when it is a comment's or a reply's id, else `invalid_argument`
 * naming `what` (`comment id`). It is a path segment, so `.` and `..` and
 * anything with a slash are refused.
 */
export function commentId(value: string, what: string): string {
  if (COMMENT_ID_PATTERN.test(value) && value !== "." && !value.includes("..")) return value
  throw new ToolError("invalid_argument", `${shown(value)} is not a ${what}.`)
}
