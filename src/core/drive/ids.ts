import { ToolError } from "../errors"

/** A file's, folder's or shared drive's id as Drive writes one. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

/** The alias for the root of My Drive, which only a folder argument takes. */
export const ROOT_FOLDER = "root"

/** How much of a refused value an error repeats. */
const MAX_SHOWN_LENGTH = 100

function checkedId(value: string, what: string): string {
  if (ID_PATTERN.test(value)) return value
  const shown = value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH)}…` : value
  throw new ToolError("invalid_argument", `${JSON.stringify(shown)} is not a ${what}.`)
}

/** `value` when it is an id Drive could have written, else `invalid_argument` naming `what` (`file id`); `root` is no id but a folder's alias. */
export function driveId(value: string, what: string): string {
  if (value === ROOT_FOLDER) {
    throw new ToolError(
      "invalid_argument",
      `\`${ROOT_FOLDER}\` names the My Drive folder, which only a folder takes; it is not a ${what}.`,
    )
  }
  return checkedId(value, what)
}

/** `value` when it is a folder's id or `root`, else `invalid_argument`. */
export function folderId(value: string): string {
  return checkedId(value, "folder id")
}
