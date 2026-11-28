import type { GoogleSession } from "../google/session"
import { requireRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { checkedPublishAt, refusal } from "./checks"
import { playlistId, videoId } from "./ids"
import { ownPlaylist } from "./own-playlist"
import { ownVideo } from "./own-video"
import type { PlaylistState, PlaylistStatus } from "./playlist-state"
import type { PrivacyState, VideoPrivacy, YoutubePrivacyArgs } from "./privacy-args"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoState, VideoStatus } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The privacy and schedule a call asks for: a schedule keeps the video private until it; a playlist has none. */
export type PrivacyAsk = { privacy: VideoPrivacy; publish_at: string | null }

/** What every privacy change planned holds: the session, the privacy and schedule asked for, and the body sent. */
type PrivacyPlanBase = {
  session: GoogleSession
  requested: PrivacyAsk
  /** The body of the update: the id and the whole `status` (and, for a playlist, the whole `snippet`). */
  body: Record<string, unknown>
}

/** A privacy change of a video planned: the video as it was read. */
export type VideoPrivacyPlan = PrivacyPlanBase & {
  kind: "video"
  video: string
  before: VideoState
}

/** A privacy change of a playlist planned: the playlist as it was read. */
export type PlaylistPrivacyPlan = PrivacyPlanBase & {
  kind: "playlist"
  playlist: string
  before: PlaylistState
}

export type PrivacyPlan = VideoPrivacyPlan | PlaylistPrivacyPlan

/** Whether two schedules are the same instant, or both none. */
export function sameSchedule(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : Date.parse(a) === Date.parse(b)
}

/** The privacy and schedule of a video's status, as the tool reports them. */
export function privacyOf({ privacyStatus, publishAt }: VideoStatus): PrivacyState {
  return { privacy: privacyStatus, publish_at: publishAt ?? null }
}

/**
 * The privacy and schedule `args` ask for, `publish_at` as UTC and in the
 * future by `now`; exactly one of the two arguments is needed, and a time that
 * has passed is refused since Google would publish at once.
 */
function requestedPrivacy(args: YoutubePrivacyArgs, now: () => number): PrivacyAsk {
  const { privacy, publish_at: time } = args
  if (privacy !== undefined && time === undefined) return { privacy, publish_at: null }
  if (time === undefined || privacy !== undefined) throw refusal("Give exactly one of `privacy` and `publish_at`")
  const publishAt = checkedPublishAt(time)
  if (Date.parse(publishAt) <= now()) {
    throw refusal(
      `\`publish_at\` ${publishAt} is not in the future, and Google publishes a video at once when its time has passed; use \`privacy: public\` to publish now`,
    )
  }
  return { privacy: "private", publish_at: publishAt }
}

/** The video's whole `status` as read, with the privacy and schedule asked for; the made-for-kids and synthetic-media flags are not sent. */
function statusBody(
  {
    privacyStatus: _privacy,
    publishAt: _publishAt,
    selfDeclaredMadeForKids: _kids,
    containsSyntheticMedia: _synthetic,
    ...kept
  }: VideoStatus,
  { privacy, publish_at }: PrivacyAsk,
) {
  return { ...kept, privacyStatus: privacy, ...(publish_at !== null && { publishAt: publish_at }) }
}

/** What a request that changes nothing says: the video is already so. */
function alreadyThere({ privacy, publish_at }: PrivacyAsk): string {
  if (publish_at !== null) return `The video is already scheduled for ${publish_at}`
  return privacy === "private"
    ? "The video is already private, with no schedule"
    : `The video is already ${privacy}, with no schedule`
}

/**
 * What a privacy change is of: exactly one of `video` and `playlist`, as the
 * call gave it; any other call is `invalid_argument`.
 */
export function privacySubject({
  video,
  playlist,
}: Pick<YoutubePrivacyArgs, "video" | "playlist">): { video: string } | { playlist: string } {
  if (video !== undefined && playlist === undefined) return { video }
  if (playlist !== undefined && video === undefined) return { playlist }
  throw refusal("Give exactly one of `video` and `playlist`")
}

/** The privacy `args` ask for a playlist, which has no schedule: `privacy` alone. */
function requestedPlaylistPrivacy({ privacy, publish_at: time }: YoutubePrivacyArgs): PrivacyAsk {
  if (time !== undefined) throw refusal("`publish_at` schedules a video; a playlist has no schedule")
  if (privacy === undefined) throw refusal("Give `privacy` to change a playlist")
  return { privacy, publish_at: null }
}

/** The playlist's whole `status` as read, with the privacy asked for; the podcast status goes only when it is `enabled` or `disabled`, which Google takes, not `unspecified`. */
function playlistStatusBody({ podcastStatus }: PlaylistStatus, { privacy }: PrivacyAsk) {
  return {
    privacyStatus: privacy,
    ...((podcastStatus === "enabled" || podcastStatus === "disabled") && { podcastStatus }),
  }
}

/**
 * Reads the label's channel and the video, which must be the channel's own,
 * and plans the update of its whole `status`. A request that leaves the
 * privacy and schedule as they are is `invalid_argument`.
 */
async function planVideoPrivacy(video: string, args: YoutubePrivacyArgs, ctx: ToolContext): Promise<VideoPrivacyPlan> {
  const requested = requestedPrivacy(args, () => requireRuntime(ctx, "YouTube writes").runtime.now())
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.videosUpdate)
  const { state } = await ownVideo(session, video)
  const now = privacyOf(state.status)
  if (now.privacy === requested.privacy && sameSchedule(now.publish_at, requested.publish_at)) {
    throw refusal(alreadyThere(requested))
  }
  return {
    kind: "video",
    session,
    video,
    before: state,
    requested,
    body: { id: video, status: statusBody(state.status, requested) },
  }
}

/**
 * Reads the label's channel and the playlist, which must be the channel's own,
 * and plans the update of its `status` with its whole `snippet` as read, which
 * Google requires with a title whenever a snippet is sent. A request that
 * leaves the privacy as it is is `invalid_argument`.
 */
async function planPlaylistPrivacy(
  playlist: string,
  args: YoutubePrivacyArgs,
  ctx: ToolContext,
): Promise<PlaylistPrivacyPlan> {
  const requested = requestedPlaylistPrivacy(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistsUpdate)
  const { state } = await ownPlaylist(session, playlist)
  if (state.status.privacyStatus === requested.privacy) {
    throw refusal(`The playlist is already ${requested.privacy}`)
  }
  return {
    kind: "playlist",
    session,
    playlist,
    before: state,
    requested,
    body: { id: playlist, snippet: state.snippet, status: playlistStatusBody(state.status, requested) },
  }
}

/**
 * Checks the arguments (one of `video` and `playlist`; for a video one of
 * `privacy` and a schedule in the future, for a playlist `privacy` alone) and
 * the label's scopes before anything is read, then reads the label's channel
 * and the video or playlist, which must be the channel's own, and plans the
 * update. A request that leaves the privacy (and schedule) as they are is
 * `invalid_argument`.
 */
export async function planPrivacy(args: YoutubePrivacyArgs, ctx: ToolContext): Promise<PrivacyPlan> {
  const subject = privacySubject(args)
  return "playlist" in subject
    ? planPlaylistPrivacy(playlistId(subject.playlist), args, ctx)
    : planVideoPrivacy(videoId(subject.video), args, ctx)
}
