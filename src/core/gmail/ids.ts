import { ToolError } from "../errors"

/** A message's or thread's id as Gmail writes one. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

/** How much of a refused value an error repeats. */
const MAX_SHOWN_LENGTH = 100

/** `value` when it is an id Gmail could have written, else `invalid_argument` naming `what` (`message id`). */
export function gmailId(value: string, what: string): string {
  if (ID_PATTERN.test(value)) return value
  const shown = value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH)}…` : value
  throw new ToolError("invalid_argument", `${JSON.stringify(shown)} is not a ${what}.`)
}
