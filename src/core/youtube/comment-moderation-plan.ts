import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import type { ModerationStatus } from "./comment-args"
import { commentIds } from "./ids"
import { ownComments, type OwnComments } from "./own-comments"
import { YOUTUBE_ROUTES } from "./routes"
import { commentTarget, foundTargets } from "./target"
import { youtubeWriteSession } from "./write-session"

/** The arguments the moderation tools share: the label and the comments, as the caller gave them. */
export type ModerationArgs = { account?: string; comments: string[] }

/** A moderation planned: the comments and their videos as they were read, the status they are set to, and whether their authors are banned. */
export type ModerationPlan = OwnComments & {
  session: GoogleSession
  /** The comment ids, each once, in the order given. */
  ids: string[]
  status: ModerationStatus
  ban: boolean
}

/**
 * Checks the comment ids (each once) and the label's scopes before anything is
 * read, then reads the comments and their videos, which must be the label's own
 * channel's (see `ownComments`).
 */
export async function planModeration(
  args: ModerationArgs,
  ctx: ToolContext,
  status: ModerationStatus,
  ban = false,
): Promise<ModerationPlan> {
  const ids = commentIds(args.comments)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.commentsModerate)
  return { ...(await ownComments(session, ids)), session, ids, status, ban }
}

/**
 * The target of each comment moderated: the ids are checked first, then the
 * label's scopes, then Google is read for the video of each comment (see
 * `foundTargets`).
 */
export async function moderationTargets(args: ModerationArgs, ctx: ToolContext): Promise<string[]> {
  const ids = commentIds(args.comments)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.commentsModerate)
  return foundTargets(ctx, async () =>
    (await ownComments(session, ids)).comments.map(({ id, video }) => commentTarget(session.label, video, id)),
  )
}
