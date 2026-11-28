import { createHash } from "node:crypto"
import { canonicalJson } from "../pin"
import type { CallFact, CallText } from "../tool"
import type { CommentVideo, OwnComment } from "./own-comments"
import { privacyFact } from "./video-facts"
import { YOUTUBE_WORDS } from "./words"

/** What a prompt names a comment's author as when Google gave none. */
export const UNKNOWN_AUTHOR = "unknown"

/** The digest of what was read of a comment or a video, which the prompt pins: a value that changed after the prompt gives another one. */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

/** A line break in a comment's text, which would pass for the start of another comment's line. */
const LINE_BREAKS = /\s*[\n\r\v\f\u0085\u2028\u2029]\s*/g

/** One comment as a line of the prompt's text: `author: text`, its text as Google gives it but on one line. */
function commentLine({ author, text }: OwnComment): string {
  return `${author ?? UNKNOWN_AUTHOR}: ${text.replace(LINE_BREAKS, " ")}`
}

/** The text of a moderation: a line for each comment, by its author. */
export function commentsText(comments: readonly OwnComment[]): CallText {
  return { label: YOUTUBE_WORDS.comments, body: comments.map(commentLine).join("\n") }
}

/** Who can watch the comments: the privacy of their video when they are all on one, else how many videos they are on. */
export function videosFact(videos: readonly CommentVideo[]): CallFact {
  const [only] = videos
  if (videos.length === 1 && only !== undefined) return privacyFact(YOUTUBE_WORDS.privacy, only.status)
  return { label: YOUTUBE_WORDS.videos, value: { text: YOUTUBE_WORDS.videosMany, values: { count: videos.length } } }
}
