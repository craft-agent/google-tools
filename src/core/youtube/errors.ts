import { ToolError, isToolError } from "../errors"
import { decodeEntities } from "./views"

/** What a rate-limited call's message goes on to say: Google's quota is the project's, counted by Pacific day. */
const QUOTA_RESET_SENTENCE = " The YouTube quota resets at midnight Pacific time."

/** The HTTP status of the answer Google gives a request it refuses for its content. */
const HTTP_BAD_REQUEST = 400

/** The HTTP status of the answer Google gives a call it refuses to the account. */
const HTTP_FORBIDDEN = 403

/** The HTTP status of the answer Google gives a caption track that exists already, or a playlist that is full. */
const HTTP_CONFLICT = 409

/** The reason of a 409 that says the video has a caption track of that language and name. */
const CAPTION_EXISTS_REASON = "captionExists"

/** The reason of a 409 that says the playlist holds as many videos as YouTube allows. */
const PLAYLIST_FULL_REASON = "playlistContainsMaximumNumberOfVideos"

/** The reasons of a 400 that say the playlist is sorted automatically, which a position cannot be set in. */
const MANUAL_SORT_REASONS: ReadonlySet<unknown> = new Set(["manualSortRequired"])

/** The reasons of a 400 that say a value of a write is not one YouTube accepts. */
const INVALID_VALUE_REASONS: ReadonlySet<unknown> = new Set([
  "invalidTitle",
  "invalidDescription",
  "invalidTags",
  "invalidCategoryId",
  "invalidPublishAt",
  "invalidVideoMetadata",
  "invalidMetadata",
  "nameTooLong",
  "contentRequired",
  "commentTextTooLong",
  "commentTextRequired",
  "parentIdMissing",
  "invalidModerationStatus",
  "banWithoutReject",
  "invalidPlaylistSnippet",
  "invalidContentDetails",
  "videoAlreadyInAnotherSeriesPlaylist",
  PLAYLIST_FULL_REASON,
])

/** The reasons of a 403 that say the comment thread takes no replies, or the playlist takes no such change or no one's entries. */
const UNSUPPORTED_OPERATION_REASONS: ReadonlySet<unknown> = new Set([
  "operationNotSupported",
  "playlistOperationUnsupported",
  "playlistItemsNotAccessible",
])

/** The reasons of a 400 that say the channel has uploaded as many videos as YouTube allows for now. */
const UPLOAD_LIMIT_REASONS: ReadonlySet<unknown> = new Set(["uploadLimitExceeded", "uploadRateLimitExceeded"])

/** What an upload limit's message says, before Google's own words. */
const UPLOAD_LIMIT_SENTENCE = "The channel has uploaded as many videos as YouTube allows for now"

/** What a caption conflict's message says, before Google's own words. */
const CAPTION_EXISTS_SENTENCE =
  "The video already has a caption track of that language and name; to replace its file or draft state use `google_youtube_caption_update`"

/** What a manual-sort refusal's message says, before Google's own words. */
const MANUAL_SORT_SENTENCE =
  "The playlist is sorted automatically, and a position needs manual sorting, which is set in YouTube Studio"

/** Whether Google answered `error` with a 409 that says the caption track exists already, which the client maps to `upstream_error`. */
function isCaptionConflict(error: ToolError): boolean {
  return (
    error.code === "upstream_error" &&
    error.details?.status === HTTP_CONFLICT &&
    error.details.reason === CAPTION_EXISTS_REASON
  )
}

/** Whether Google answered `error` with a 409 that says the playlist holds as many videos as YouTube allows, which the client maps to `upstream_error`. */
function isPlaylistFull(error: ToolError): boolean {
  return (
    error.code === "upstream_error" &&
    error.details?.status === HTTP_CONFLICT &&
    error.details.reason === PLAYLIST_FULL_REASON
  )
}

/** Whether Google answered `error` with a 403 that says the thread or the playlist takes no such operation, which the client maps to `upstream_error`. */
function isUnsupportedOperation(error: ToolError): boolean {
  return (
    error.code === "upstream_error" &&
    error.details?.status === HTTP_FORBIDDEN &&
    UNSUPPORTED_OPERATION_REASONS.has(error.details.reason)
  )
}

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
 * says the channel's uploads are used up as `rate_limited`. A 400 that refuses
 * a caption track's metadata or file is `invalid_argument` too, and a 409 that
 * says the track exists already is `invalid_argument` pointing to the update.
 * A 400 that refuses a comment's text, its parent or a moderation status is
 * `invalid_argument` too, and a 403 that says the thread takes no replies is
 * `forbidden`. A 400 that refuses a playlist's snippet or an entry's details,
 * a video that is in a series playlist already, or a 409 that says the
 * playlist is full, is `invalid_argument` too; so is a 400 that says a position
 * needs a playlist sorted by hand, with a sentence that says where that is set.
 * A 403 that says the playlist takes no such operation, or none of its
 * entries, is `forbidden`.
 */
export function youtubeError(error: unknown): unknown {
  if (!isToolError(error)) return error
  const plain = decodeEntities(error.message.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
  const uploadLimit = isBadRequest(error, UPLOAD_LIMIT_REASONS)
  const captionExists = isCaptionConflict(error)
  const manualSort = isBadRequest(error, MANUAL_SORT_REASONS)
  let code = error.code
  if (uploadLimit) code = "rate_limited"
  else if (captionExists || manualSort || isPlaylistFull(error) || isBadRequest(error, INVALID_VALUE_REASONS)) {
    code = "invalid_argument"
  } else if (isUnsupportedOperation(error)) code = "forbidden"
  let message = plain
  if (uploadLimit) message = `${UPLOAD_LIMIT_SENTENCE} (Google: ${plain.replace(/\.$/, "")}).`
  else if (captionExists) message = `${CAPTION_EXISTS_SENTENCE} (Google: ${plain.replace(/\.$/, "")}).`
  else if (manualSort) message = `${MANUAL_SORT_SENTENCE} (Google: ${plain.replace(/\.$/, "")}).`
  const suffix = code === "rate_limited" ? QUOTA_RESET_SENTENCE : ""
  if (message === error.message && suffix === "" && code === error.code) return error
  return new ToolError(code, `${message}${suffix}`, { cause: error, details: error.details })
}
