import { z } from "zod"
import { clippedCommentText, commentTextShape, pageReply } from "./views"

/** A comment as `comments.list` gives it, or as `commentThreads.list` holds it; every field not read here is left out of the parse. */
const commentReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      authorDisplayName: z.string().optional(),
      authorChannelId: z.object({ value: z.string().optional() }).optional(),
      textDisplay: z.string().optional(),
      textOriginal: z.string().optional(),
      likeCount: z.number().optional(),
      publishedAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
})

/** A thread as `commentThreads.list` gives it, with the parts `snippet` and `replies`. */
const threadReply = z.object({
  id: z.string(),
  snippet: z.object({ topLevelComment: commentReply.optional(), totalReplyCount: z.number().optional() }).optional(),
  replies: z.object({ comments: z.array(commentReply).optional() }).optional(),
})

export const threadsList = z.object({ items: z.array(threadReply).optional(), ...pageReply })

export const repliesList = z.object({ items: z.array(commentReply).optional(), ...pageReply })

const replySchema = z.object({
  /** A thread's id is its top-level comment's, which `thread` takes; a reply's holds a `.`. */
  comment_id: z.string(),
  author: z.string().nullable(),
  author_channel_id: z.string().nullable(),
  ...commentTextShape,
  like_count: z.number().nullable(),
  published_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

export const commentSchema = replySchema.extend({
  /** Every reply of the thread; `null` for a reply. */
  reply_count: z.number().nullable(),
  /** The replies Google included with the thread, which can be fewer than `reply_count`; `null` for a reply. */
  replies: z.array(replySchema).nullable(),
})

export type CommentView = z.output<typeof commentSchema>

type CommentReply = z.output<typeof commentReply>
type ReplyView = z.output<typeof replySchema>

function replyView(comment: CommentReply): ReplyView {
  const { snippet } = comment
  return {
    comment_id: comment.id,
    author: snippet?.authorDisplayName ?? null,
    author_channel_id: snippet?.authorChannelId?.value ?? null,
    ...clippedCommentText(snippet?.textDisplay ?? snippet?.textOriginal),
    like_count: snippet?.likeCount ?? null,
    published_at: snippet?.publishedAt ?? null,
    updated_at: snippet?.updatedAt ?? null,
  }
}

/** What the read returns of a reply, listed on its own: it has no replies. */
export function commentView(comment: CommentReply): CommentView {
  return { ...replyView(comment), reply_count: null, replies: null }
}

/** What the read returns of a thread: its top-level comment under the thread's id, with the replies Google included. */
export function threadView(thread: z.output<typeof threadReply>): CommentView {
  const top = thread.snippet?.topLevelComment
  return {
    ...replyView({ ...top, id: thread.id }),
    reply_count: thread.snippet?.totalReplyCount ?? 0,
    replies: (thread.replies?.comments ?? []).map(replyView),
  }
}
