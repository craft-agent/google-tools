import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_REPLY_CHARACTERS } from "./checks"
import { commentSchema } from "./comment-view"

/** The most comments one moderation call takes, which is Google's own limit of ids for the call. */
export const MAX_COMMENTS = 50

/** What a comment can be moderated to by `google_youtube_comment_moderate`. */
export const COMMENT_MODERATIONS = ["publish", "hold"] as const

/** The moderation status Google names for each of them. */
export const MODERATION_STATUSES = { publish: "published", hold: "heldForReview" } as const

/** The moderation statuses the tools set: those of the two moderations and the final one of a rejection. */
export type ModerationStatus = (typeof MODERATION_STATUSES)[CommentModeration] | "rejected"

const commentsArg = z
  .array(z.string())
  .min(1)
  .max(MAX_COMMENTS)
  .describe(
    `1 to ${MAX_COMMENTS} comment ids (a thread's or a reply's \`comment_id\`, as \`google_youtube_read\` method \`comments\` gives it; a repeated one counts once). Every comment must be on one of the channel's own videos.`,
  )

export const youtubeCommentReplyInput = z.strictObject({
  account: accountArg,
  thread: z
    .string()
    .describe(
      "The thread to reply to: its `comment_id`, as `google_youtube_read` method `comments` gives it. A reply's id (one with a `.`) is refused: replies go to the thread's top-level comment. The thread must be on one of the channel's own videos.",
    ),
  text: z
    .string()
    .describe(`The reply's text, 1 to ${MAX_REPLY_CHARACTERS} characters and not blank; it is public as it stands.`),
})

export const youtubeCommentReplyOutput = z.object({
  video_id: z.string(),
  thread: z.string().describe("The thread replied to."),
  reply: commentSchema.describe("The reply as Google reports it."),
})

export const youtubeCommentModerateInput = z.strictObject({
  account: accountArg,
  comments: commentsArg,
  moderation: z
    .enum(COMMENT_MODERATIONS)
    .describe(
      "`publish` (the comments are shown, at once on a public video) or `hold` (they are hidden until published).",
    ),
})

export const youtubeCommentModerateOutput = z.object({
  comments: z.array(z.string()).describe("The ids of the comments moderated."),
  moderation: z.enum(["published", "heldForReview"]).describe("The status they were set to."),
  videos: z.array(z.string()).describe("The ids of the videos the comments are on."),
})

export const youtubeCommentRejectInput = z.strictObject({
  account: accountArg,
  comments: commentsArg,
  ban_author: z
    .boolean()
    .optional()
    .describe(
      "Whether to ban the comments' authors, whose later comments are then kept off the channel; default false.",
    ),
})

export const youtubeCommentRejectOutput = z.object({
  comments: z.array(z.string()).describe("The ids of the comments rejected."),
  moderation: z.literal("rejected"),
  banned_authors: z.boolean().describe("Whether the authors were banned."),
  videos: z.array(z.string()).describe("The ids of the videos the comments are on."),
})

export type CommentModeration = (typeof COMMENT_MODERATIONS)[number]
export type YoutubeCommentReplyArgs = z.output<typeof youtubeCommentReplyInput>
export type YoutubeCommentReplyResult = z.input<typeof youtubeCommentReplyOutput>
export type YoutubeCommentModerateArgs = z.output<typeof youtubeCommentModerateInput>
export type YoutubeCommentModerateResult = z.input<typeof youtubeCommentModerateOutput>
export type YoutubeCommentRejectArgs = z.output<typeof youtubeCommentRejectInput>
export type YoutubeCommentRejectResult = z.input<typeof youtubeCommentRejectOutput>
