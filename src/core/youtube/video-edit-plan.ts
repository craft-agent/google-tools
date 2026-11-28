import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { refusal } from "./checks"
import { videoId } from "./ids"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import type { YoutubeVideoEditArgs } from "./video-edit-args"
import { checkEdit } from "./video-edit-checks"
import { EDIT_PARTS, changedFields, mergedState, type EditPart, type FieldChange } from "./video-edit-merge"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** An edit planned: the video as it was and as it will be, the fields that change and what is sent. */
export type VideoEditPlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  before: VideoState
  /** The video as the edit leaves it, which is what is sent of the parts the edit touches. */
  after: VideoState
  changes: FieldChange[]
  /** The parts sent, in the order `part` lists them. */
  parts: EditPart[]
  /** The body of the update: the video's id and each part sent, whole. */
  body: Record<string, unknown>
}

/** The snippet as Google takes it: whole, without an empty tag list, which says the same as none. */
function snippetBody({ tags, ...snippet }: VideoState["snippet"]) {
  return tags.length > 0 ? { ...snippet, tags } : snippet
}

/**
 * The status as Google takes it: whole as read, but for the made-for-kids and
 * synthetic-media flags, which Google changes only when sent, so they go only
 * when the call sets them.
 */
function statusBody(
  { selfDeclaredMadeForKids, containsSyntheticMedia, ...status }: VideoState["status"],
  args: YoutubeVideoEditArgs,
) {
  return {
    ...status,
    ...(args.made_for_kids !== undefined && { selfDeclaredMadeForKids }),
    ...(args.synthetic_media !== undefined && { containsSyntheticMedia }),
  }
}

/** The body of the update: the video's id and each part the edit touches. */
function bodyOf(after: VideoState, parts: readonly EditPart[], args: YoutubeVideoEditArgs): Record<string, unknown> {
  return {
    id: after.id,
    ...(parts.includes("snippet") && { snippet: snippetBody(after.snippet) }),
    ...(parts.includes("status") && { status: statusBody(after.status, args) }),
    ...(parts.includes("localizations") && { localizations: after.localizations }),
  }
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the label's channel and the video, which must be the channel's own,
 * and plans the update: the changes, and the parts they touch, sent whole as
 * read with the changes applied. An edit that leaves every value as it is is
 * `invalid_argument`.
 */
export async function planVideoEdit(args: YoutubeVideoEditArgs, ctx: ToolContext): Promise<VideoEditPlan> {
  const video = videoId(args.video)
  checkEdit(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.videosUpdate)
  const { state } = await ownVideo(session, video)
  const after = mergedState(state, args)
  const changes = changedFields(state, after, args)
  if (changes.length === 0) throw refusal("The video already has these values")
  const parts = EDIT_PARTS.filter((part) => changes.some((change) => change.part === part))
  return { session, video, before: state, after, changes, parts, body: bodyOf(after, parts, args) }
}
