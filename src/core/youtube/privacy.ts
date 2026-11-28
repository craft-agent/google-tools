import { parseReply } from "../sheets/reply"
import { defineTool, type ToolContext } from "../tool"
import { youtubeError } from "./errors"
import {
  youtubePrivacyInput,
  youtubePrivacyOutput,
  type PrivacyState,
  type YoutubePrivacyArgs,
  type YoutubePrivacyResult,
} from "./privacy-args"
import { playlistStateReply } from "./playlist-state"
import { describePrivacy } from "./privacy-describe"
import { planPrivacy, privacyOf, privacySubject, sameSchedule, type PrivacyPlan } from "./privacy-plan"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_TOOLSET } from "./scopes"
import { playlistTargets, videoTargets } from "./target"
import { videoStateReply } from "./video-state"
import { playlistUrl, videoUrl } from "./views"

/** A privacy as a sentence says it: the privacy, and `until` the time while a schedule is set. */
function shownPrivacy({ privacy, publish_at }: PrivacyState): string {
  const word = privacy ?? "no privacy"
  return publish_at === null ? word : `${word} until ${publish_at}`
}

/** What to tell when Google reports something other than what was asked, or nothing when it reports exactly that. */
function noteOf(plan: PrivacyPlan, after: PrivacyState): string | null {
  const { kind, requested } = plan
  if (after.privacy === null) {
    return `Google did not report the ${kind}'s privacy after the change; check it in YouTube Studio.`
  }
  if (after.privacy === requested.privacy && sameSchedule(after.publish_at, requested.publish_at)) return null
  const reported = `Google reports the ${kind} as ${shownPrivacy(after)}, not ${shownPrivacy(requested)} as asked. Check it in YouTube Studio`
  return kind === "video" ? `${reported}: an account setting can keep a video private.` : `${reported}.`
}

/** Sends the update the plan holds and returns the privacy and schedule Google reports after it. */
async function sendPrivacy(plan: PrivacyPlan): Promise<PrivacyState> {
  try {
    if (plan.kind === "playlist") {
      const reply = await plan.session.client.request(YOUTUBE_ROUTES.playlistsUpdate, {
        query: { part: "snippet,status" },
        body: plan.body,
      })
      const { status } = parseReply(playlistStateReply, reply, "the privacy change")
      return { privacy: status?.privacyStatus ?? null, publish_at: null }
    }
    const reply = await plan.session.client.request(YOUTUBE_ROUTES.videosUpdate, {
      query: { part: "status" },
      body: plan.body,
    })
    const { status } = parseReply(videoStateReply, reply, "the privacy change")
    return { privacy: status?.privacyStatus ?? null, publish_at: status?.publishAt ?? null }
  } catch (error) {
    throw youtubeError(error)
  }
}

/** Changes the video's or playlist's privacy, or the video's schedule, and returns what was asked, what it was and what Google reports. */
export async function setPrivacy(args: YoutubePrivacyArgs, ctx: ToolContext): Promise<YoutubePrivacyResult> {
  const plan = await planPrivacy(args, ctx)
  const after = await sendPrivacy(plan)
  const subject =
    plan.kind === "video"
      ? { video_id: plan.video, playlist_id: null, url: videoUrl(plan.video) }
      : { video_id: null, playlist_id: plan.playlist, url: playlistUrl(plan.playlist) }
  return {
    ...subject,
    requested: plan.requested,
    before: privacyOf(plan.before.status),
    after,
    note: noteOf(plan, after),
  }
}

export const googleYoutubePrivacySet = defineTool({
  id: "google_youtube_privacy_set",
  title: "Set YouTube video privacy",
  intent: "About to change who can watch a YouTube video",
  description:
    "Change who can watch a video or a playlist of the account's own YouTube channel, given by `video` or by `playlist` (its id or address), exactly one: for a video give `privacy` (`private`, `unlisted` or `public`) or `publish_at`, exactly one; a playlist takes `privacy` alone, since it has no schedule (`publish_at` with a `playlist` is `invalid_argument`). This decides who sees it, and a public video or playlist is seen and shared at once, so the call asks every time. A new playlist is private: this is how it becomes unlisted or public. " +
    "`publish_at` schedules a video: an RFC 3339 time with its offset (such as `2026-12-24T09:00:00+09:00`) in the future by the clock this runs on, which makes the video private until then. A time that has passed is refused, since Google would publish the video at once: that is `privacy: public`. " +
    "`privacy: private` with no time also clears a video's schedule, and `unlisted` or `public` drop it; a call that leaves the privacy (and schedule) as they are is `invalid_argument`. " +
    "Only the channel's own videos and playlists can be changed: one of another channel, and the channel's uploads playlist, are `forbidden` and nothing is sent; one that does not exist, or that the account cannot see, is `not_found`. " +
    "The video's whole `status` is read first and sent back with the new privacy and schedule; the made-for-kids and synthetic-media flags are not sent. A playlist's `status` goes back the same way, with its whole `snippet` as read, which YouTube requires with a title when a snippet is sent. " +
    "Returns the `video_id` or the `playlist_id` (the other is null), its `url`, what was `requested`, the privacy and schedule it `before` had and `after` has as Google reports it (each `privacy` and `publish_at`, a playlist's `publish_at` always null), and a `note`: when Google reports something other than what was asked (an account setting can keep a video private), the note says what it reports and to check YouTube Studio; otherwise null. " +
    "Quota: 50 units for the update and 1 each for the two reads before it (the channel and the video or playlist); the quota resets at midnight Pacific time. " +
    "`account` is needed when several accounts are set up.",
  toolset: YOUTUBE_TOOLSET,
  class: "administrative",
  input: youtubePrivacyInput,
  output: youtubePrivacyOutput,
  targets(args, ctx) {
    const subject = privacySubject(args)
    return "playlist" in subject
      ? playlistTargets({ ...args, ...subject }, ctx, YOUTUBE_ROUTES.playlistsUpdate)
      : videoTargets({ ...args, ...subject }, ctx, YOUTUBE_ROUTES.videosUpdate)
  },
  async describe(args, ctx) {
    return describePrivacy(await planPrivacy(args, ctx))
  },
  execute: (args, ctx) => setPrivacy(args, ctx),
})
