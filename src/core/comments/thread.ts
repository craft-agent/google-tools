import { MAX_TEXT_CHARACTERS, type CommentReply, type CommentThread, type CommentsReadResult } from "./schemas"

/** `text` cut at `MAX_TEXT_CHARACTERS` code points, and whether it was cut. */
export function clipText(text: string): { text: string; text_clipped: boolean } {
  const characters = Array.from(text)
  if (characters.length <= MAX_TEXT_CHARACTERS) return { text, text_clipped: false }
  return { text: characters.slice(0, MAX_TEXT_CHARACTERS).join(""), text_clipped: true }
}

/** One post of a thread as a change needs it: whole (never clipped), with what decides whether it may be edited or deleted. */
export type ThreadPost = {
  /** What Google names the post by: a spreadsheet's post id, or a Drive reply's id (a Drive comment's own first post is the comment's id). */
  postId: string
  author: string | null
  /** Whether the account itself wrote it. */
  me: boolean
  text: string
  /** What the post did to its thread besides saying something. */
  action: CommentReply["action"]
  /** The assignee the post carries; always `null` for a Drive reply, which the read of one comment does not ask for. */
  assignee: string | null
}

/** A live thread as a change needs it: its status, its cell, its first post and its live replies, in Google's order. */
export type LocatedThread = {
  commentId: string
  status: CommentThread["status"]
  at: string | null
  head: ThreadPost
  replies: ThreadPost[]
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
