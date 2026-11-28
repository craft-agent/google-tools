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
import { describePrivacy } from "./privacy-describe"
import { planPrivacy, privacyOf, sameSchedule, type PrivacyAsk } from "./privacy-plan"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_TOOLSET } from "./scopes"
import { videoTargets } from "./target"
import { videoStateReply } from "./video-state"
import { videoUrl } from "./views"

/** A privacy as a sentence says it: the privacy, and `until` the time while a schedule is set. */
function shownPrivacy({ privacy, publish_at }: PrivacyState): string {
  const word = privacy ?? "no privacy"
  return publish_at === null ? word : `${word} until ${publish_at}`
}

/** What to tell when Google reports something other than what was asked, or nothing when it reports exactly that. */
function noteOf(requested: PrivacyAsk, after: PrivacyState): string | null {
  if (after.privacy === null) {
    return "Google did not report the video's privacy after the change; check it in YouTube Studio."
  }
  if (after.privacy === requested.privacy && sameSchedule(after.publish_at, requested.publish_at)) return null
  return `Google reports the video as ${shownPrivacy(after)}, not ${shownPrivacy(requested)} as asked. Check it in YouTube Studio: an account setting can keep a video private.`
}

/** Changes the video's privacy or schedule and returns what was asked, what it was and what Google reports. */
export async function setPrivacy(args: YoutubePrivacyArgs, ctx: ToolContext): Promise<YoutubePrivacyResult> {
  const plan = await planPrivacy(args, ctx)
  let reply: unknown
  try {
    reply = await plan.session.client.request(YOUTUBE_ROUTES.videosUpdate, {
      query: { part: "status" },
      body: plan.body,
    })
  } catch (error) {
    throw youtubeError(error)
  }
  const { status } = parseReply(videoStateReply, reply, "the privacy change")
  const after: PrivacyState = { privacy: status?.privacyStatus ?? null, publish_at: status?.publishAt ?? null }
  return {
    video_id: plan.video,
    url: videoUrl(plan.video),
    requested: plan.requested,
    before: privacyOf(plan.before.status),
    after,
    note: noteOf(plan.requested, after),
  }
}

export const googleYoutubePrivacySet = defineTool({
  id: "google_youtube_privacy_set",
  title: "Set YouTube video privacy",
  intent: "About to change who can watch a YouTube video",
  description:
    "Change who can watch a video of the account's own YouTube channel, given by `video` (its id or address): give `privacy` (`private`, `unlisted` or `public`) or `publish_at`, exactly one. This decides who sees the video, and a public video is seen and shared at once, so the call asks every time. " +
    "`publish_at` schedules the video: an RFC 3339 time with its offset (such as `2026-12-24T09:00:00+09:00`) in the future by the clock this runs on, which makes the video private until then. A time that has passed is refused, since Google would publish the video at once: that is `privacy: public`. " +
    "`privacy: private` with no time also clears a schedule, and `unlisted` or `public` drop it; a call that leaves the privacy and schedule as they are is `invalid_argument`. " +
    "Only the channel's own videos can be changed: a video of another channel is `forbidden` and nothing is sent; one that does not exist, or that the account cannot see, is `not_found`. " +
    "The video's whole `status` is read first and sent back with the new privacy and schedule; the made-for-kids and synthetic-media flags are not sent. " +
    "Returns the `video_id`, its `url`, what was `requested`, the privacy and schedule it `before` had and `after` has as Google reports it (each `privacy` and `publish_at`), and a `note`: when Google reports something other than what was asked (an account setting can keep a video private), the note says what it reports and to check YouTube Studio; otherwise null. " +
    "Quota: 50 units for the update and 1 each for the two reads before it (the channel and the video); the quota resets at midnight Pacific time. " +
    "`account` is needed when several accounts are set up.",
  toolset: YOUTUBE_TOOLSET,
  class: "administrative",
  input: youtubePrivacyInput,
  output: youtubePrivacyOutput,
  targets: (args, ctx) => videoTargets(args, ctx, YOUTUBE_ROUTES.videosUpdate),
  async describe(args, ctx) {
    return describePrivacy(await planPrivacy(args, ctx))
  },
  execute: (args, ctx) => setPrivacy(args, ctx),
})
