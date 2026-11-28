import { ToolError } from "../errors"
import type { GoogleSession } from "../google/session"
import { shown } from "../run/ids"
import type { ToolContext } from "../tool"
import { checkedReplyText } from "./checks"
import type { YoutubeCommentReplyArgs } from "./comment-args"
import { threadId } from "./ids"
import { ownVideo } from "./own-video"
import { listThreads } from "./own-comments"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The thread and the text of a reply, checked: the arguments alone, before anything is read. */
export type ReplyAsk = { thread: string; text: string }

/** A reply planned: the thread's top-level comment and the video as they were read, and the request's body. */
export type ReplyPlan = ReplyAsk & {
  session: GoogleSession
  /** The id of the video the thread is on. */
  video: string
  /** The video as it was read. */
  state: VideoState
  /** The thread's top-level comment as read: its author and text, as Google gives them; `null` and empty when Google gives none. */
  author: string | null
  comment: string
  /** Whether Google says the thread takes replies; `null` when it says nothing (a thread that says `false` is refused). */
  canReply: boolean | null
  /** The body of the insert: the reply's parent and its text. */
  body: { snippet: { parentId: string; textOriginal: string } }
}

/** The thread and the text `args` give, each checked: a reply's id is not a thread's, and the text is 1 to 10,000 characters and not blank. */
export function checkedReply({ thread, text }: Pick<YoutubeCommentReplyArgs, "thread" | "text">): ReplyAsk {
  return { thread: threadId(thread), text: checkedReplyText(text) }
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the thread, which Google must return and which must take replies, and
 * the video it is on, which must be the label's own channel's: a thread of
 * another channel's video is `forbidden`, nothing sent, since the reply would
 * speak for the person where they did not choose to.
 */
export async function planReply(args: YoutubeCommentReplyArgs, ctx: ToolContext): Promise<ReplyPlan> {
  const ask = checkedReply(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.commentsInsert)
  const [found] = await listThreads(session, [ask.thread])
  if (found === undefined || found.id !== ask.thread) {
    throw new ToolError("not_found", `Thread ${shown(ask.thread)} was not found, or the account cannot see it.`)
  }
  const video = found.snippet?.videoId
  if (video === undefined) {
    throw new ToolError("upstream_error", `Google did not say which video thread ${shown(ask.thread)} is on.`)
  }
  const { state } = await ownVideo(session, video)
  if (found.snippet?.canReply === false) {
    throw new ToolError("forbidden", `Thread ${shown(ask.thread)} takes no replies. Nothing was sent.`)
  }
  const top = found.snippet?.topLevelComment?.snippet
  return {
    ...ask,
    session,
    video,
    state,
    author: top?.authorDisplayName ?? null,
    comment: top?.textDisplay ?? top?.textOriginal ?? "",
    canReply: found.snippet?.canReply ?? null,
    body: { snippet: { parentId: ask.thread, textOriginal: ask.text } },
  }
}
