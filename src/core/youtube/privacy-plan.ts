import type { GoogleSession } from "../google/session"
import { requireRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { checkedPublishAt, refusal } from "./checks"
import { videoId } from "./ids"
import { ownVideo } from "./own-video"
import type { PrivacyState, VideoPrivacy, YoutubePrivacyArgs } from "./privacy-args"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoState, VideoStatus } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The privacy and schedule a call asks for: a schedule keeps the video private until it. */
export type PrivacyAsk = { privacy: VideoPrivacy; publish_at: string | null }

/** A privacy change planned: the privacy and schedule asked for, the video as it was and the status sent. */
export type PrivacyPlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  before: VideoState
  requested: PrivacyAsk
  /** The body of the update: the video's id and its whole `status`. */
  body: Record<string, unknown>
}

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
 * Checks the arguments (one of the two, a schedule in the future) and the
 * label's scopes before anything is read, then reads the label's channel and
 * the video, which must be the channel's own, and plans the update of its
 * whole `status`. A request that leaves the privacy and schedule as they are
 * is `invalid_argument`.
 */
export async function planPrivacy(args: YoutubePrivacyArgs, ctx: ToolContext): Promise<PrivacyPlan> {
  const video = videoId(args.video)
  const requested = requestedPrivacy(args, () => requireRuntime(ctx, "YouTube writes").runtime.now())
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.videosUpdate)
  const { state } = await ownVideo(session, video)
  const now = privacyOf(state.status)
  if (now.privacy === requested.privacy && sameSchedule(now.publish_at, requested.publish_at)) {
    throw refusal(alreadyThere(requested))
  }
  return { session, video, before: state, requested, body: { id: video, status: statusBody(state.status, requested) } }
}
