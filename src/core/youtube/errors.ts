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

/** Whether Google refused a write for a value in it, which the client maps to `upstream_error` for any 400. */
function isInvalidValue(error: ToolError): boolean {
  return (
    error.code === "upstream_error" &&
    error.details?.status === HTTP_BAD_REQUEST &&
    INVALID_VALUE_REASONS.has(error.details.reason)
  )
}

/**
 * `error` as a YouTube tool reports it: Google's HTML in any message turned to
 * plain text, a quota failure's message going on to say when the quota resets,
 * and a 400 that refuses a title, description, tags, category, publish time or
 * the video's metadata as `invalid_argument` with Google's message.
 */
export function youtubeError(error: unknown): unknown {
  if (!isToolError(error)) return error
  const plain = decodeEntities(error.message.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
  const code = isInvalidValue(error) ? "invalid_argument" : error.code
  const suffix = code === "rate_limited" ? QUOTA_RESET_SENTENCE : ""
  if (plain === error.message && suffix === "" && code === error.code) return error
  return new ToolError(code, `${plain}${suffix}`, { cause: error, details: error.details })
}
