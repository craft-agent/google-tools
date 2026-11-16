import { MAX_TEXT_CHARACTERS, type CommentThread, type CommentsReadResult } from "./schemas"

/** `text` cut at `MAX_TEXT_CHARACTERS` code points, and whether it was cut. */
export function clipText(text: string): { text: string; text_clipped: boolean } {
  const characters = Array.from(text)
  if (characters.length <= MAX_TEXT_CHARACTERS) return { text, text_clipped: false }
  return { text: characters.slice(0, MAX_TEXT_CHARACTERS).join(""), text_clipped: true }
}

/** What the read returns of the threads found, besides their file. */
export type ThreadSelection = Pick<CommentsReadResult, "comments" | "resolved_hidden" | "more">

/**
 * The first `limit` of `threads` in the order given: every one when `resolved`,
 * else the open ones, counting the resolved threads left out and the matching
 * ones beyond `limit`.
 */
export function selectThreads(threads: readonly CommentThread[], resolved: boolean, limit: number): ThreadSelection {
  const matching = resolved ? threads : threads.filter((thread) => thread.status === "open")
  return {
    comments: matching.slice(0, limit),
    resolved_hidden: threads.length - matching.length,
    more: Math.max(0, matching.length - limit),
  }
}
