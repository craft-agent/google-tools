import { ToolError, isToolError } from "../errors"
import type { Route } from "../google/routes"
import { MAX_SPREADSHEET_COMMENT_BYTES } from "./add-args"
import { COMMENTS_ROUTES } from "./routes"
import type { ThreadPost } from "./thread"

/** What a comment write names its work as when a call has no runtime. */
export const COMMENT_WRITES = "Comment writes"

/** Any one of the writes, which a label must hold one of before the file is read; the write the file's kind needs is checked after. */
export const SOME_WRITE: Route = {
  ...COMMENTS_ROUTES.batchUpdate,
  scopes: [...COMMENTS_ROUTES.batchUpdate.scopes, ...COMMENTS_ROUTES.commentCreate.scopes],
}

/** The state of a batch whose comment changes all went through. */
const ALL_SAVED = "ALL_SAVED"

/** The state a batch is taken to be in when its answer names none. */
const UNREPORTED_STATE = "COMMENT_UPDATE_STATE_UNSPECIFIED"

/** The most characters of the state Google reported that an error repeats. */
const MAX_STATE_LENGTH = 60

const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404

/** Fails a text a spreadsheet's comment cannot hold as `invalid_argument`: Google counts its bytes in UTF-8. */
export function requireSpreadsheetLength(text: string): void {
  const bytes = Buffer.byteLength(text)
  if (bytes > MAX_SPREADSHEET_COMMENT_BYTES) {
    throw new ToolError(
      "invalid_argument",
      `The comment is ${bytes} bytes in UTF-8; a spreadsheet's comment is at most ${MAX_SPREADSHEET_COMMENT_BYTES} bytes.`,
    )
  }
}

/**
 * Fails a batch whose comment update state is not `ALL_SAVED` as
 * `upstream_error`, since the change may or may not have been made: `subject`
 * is what Google did not report as saved, `doubt` what is then unknown.
 */
export function requireSaved(state: string | undefined, subject: string, doubt: string): void {
  const reported = state ?? UNREPORTED_STATE
  if (reported === ALL_SAVED) return
  throw new ToolError(
    "upstream_error",
    `Google did not report ${subject} as saved (comment update state ${reported.slice(0, MAX_STATE_LENGTH)}). ${doubt}: read the file's comments before trying again.`,
  )
}

/** Fails a post the account did not write as `forbidden`; `verb` is what the call would do to it (`edit`, `delete`). */
export function requireOwnPost(post: Pick<ThreadPost, "me" | "author">, verb: string): void {
  if (!post.me) {
    throw new ToolError(
      "forbidden",
      `Only the author can ${verb} a post; this one was written by ${post.author ?? "someone else"}.`,
    )
  }
}

/**
 * The `forbidden` error, worded `message`, for a write Google refused with a
 * 403 or a 404 on a file the plan had read: drive.file lets these tools change
 * comments only on the files they created, and Google words the rest as either.
 * A rate limit and any other failure give `undefined`.
 */
export function commentRefusal(error: unknown, message: string): ToolError | undefined {
  if (!isToolError(error) || error.code === "rate_limited") return undefined
  const status = error.details?.status
  if (status !== HTTP_FORBIDDEN && status !== HTTP_NOT_FOUND) return undefined
  return new ToolError("forbidden", message, { cause: error, details: { status } })
}
