import { ToolError, isToolError } from "../errors"
import { decodeEntities } from "./views"

/** What a rate-limited call's message goes on to say: Google's quota is the project's, counted by Pacific day. */
const QUOTA_RESET_SENTENCE = " The YouTube quota resets at midnight Pacific time."

/** The HTTP status of the answer Google gives a request it refuses for its content. */
const HTTP_BAD_REQUEST = 400

/** The reasons of a 400 that say a value of a write is not one YouTube accepts. */
const INVALID_VALUE_REASONS: ReadonlySet<unknown> = new Set([
  "invalidTitle",
  "invalidDescription",
  "invalidTags",
  "invalidCategoryId",
  "invalidPublishAt",
  "invalidVideoMetadata",
])

/** The reasons of a 400 that say the channel has uploaded as many videos as YouTube allows for now. */
const UPLOAD_LIMIT_REASONS: ReadonlySet<unknown> = new Set(["uploadLimitExceeded", "uploadRateLimitExceeded"])

/** What an upload limit's message says, before Google's own words. */
const UPLOAD_LIMIT_SENTENCE = "The channel has uploaded as many videos as YouTube allows for now"

/** Whether Google answered `error` with a 400 for one of `reasons`, which the client maps to `upstream_error` for any 400. */
function isBadRequest(error: ToolError, reasons: ReadonlySet<unknown>): boolean {
  return (
    error.code === "upstream_error" && error.details?.status === HTTP_BAD_REQUEST && reasons.has(error.details.reason)
  )
}

/**
 * `error` as a YouTube tool reports it: Google's HTML in any message turned to
 * plain text, a quota failure's message going on to say when the quota resets,
 * a 400 that refuses a title, description, tags, category, publish time or the
 * video's metadata as `invalid_argument` with Google's message, and a 400 that
 * says the channel's uploads are used up as `rate_limited`.
 */
export function youtubeError(error: unknown): unknown {
  if (!isToolError(error)) return error
  const plain = decodeEntities(error.message.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
  const uploadLimit = isBadRequest(error, UPLOAD_LIMIT_REASONS)
  let code = error.code
  if (uploadLimit) code = "rate_limited"
  else if (isBadRequest(error, INVALID_VALUE_REASONS)) code = "invalid_argument"
  const message = uploadLimit ? `${UPLOAD_LIMIT_SENTENCE} (Google: ${plain.replace(/\.$/, "")}).` : plain
  const suffix = code === "rate_limited" ? QUOTA_RESET_SENTENCE : ""
  if (message === error.message && suffix === "" && code === error.code) return error
  return new ToolError(code, `${message}${suffix}`, { cause: error, details: error.details })
}
