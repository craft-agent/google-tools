import { z } from "zod"
import { accountArg } from "../sheets/schemas"

/** The privacies a video or a playlist can be set to. */
export const VIDEO_PRIVACIES = ["private", "unlisted", "public"] as const

export const youtubePrivacyInput = z.strictObject({
  account: accountArg,
  video: z
    .string()
    .optional()
    .describe(
      "The video's id, or its YouTube address (https://www.youtube.com/watch?v=<id>). It must be the channel's own. Give this or `playlist`, not both.",
    ),
  playlist: z
    .string()
    .optional()
    .describe(
      "The playlist's id, or its YouTube address (https://www.youtube.com/playlist?list=<id>). It must be one of the channel's own playlists, and never the uploads playlist. Give this or `video`, not both.",
    ),
  privacy: z
    .enum(VIDEO_PRIVACIES)
    .optional()
    .describe(
      "`private` (only the channel; for a video it also clears a schedule), `unlisted` (anyone with the link) or `public` (everyone, at once). For a video give this or `publish_at`, not both; a playlist takes this alone.",
    ),
  publish_at: z
    .string()
    .optional()
    .describe(
      "Schedules a video, never a playlist: it stays private and goes public at this time, an RFC 3339 time in the future with its offset, such as `2026-12-24T09:00:00+09:00`. Give this or `privacy`, not both.",
    ),
})

const privacyState = z.object({
  privacy: z.string().nullable().describe("`private`, `unlisted` or `public`; null when Google gave none."),
  publish_at: z.string().nullable().describe("When a private video goes public, in UTC; null when none is set."),
})

export const youtubePrivacyOutput = z.object({
  video_id: z.string().nullable().describe("The video changed; null when a playlist was."),
  playlist_id: z.string().nullable().describe("The playlist changed; null when a video was."),
  url: z.string().describe("The address of the video or the playlist."),
  requested: privacyState.describe("What the call asked for."),
  before: privacyState.describe("The privacy and schedule the video or playlist had; a playlist has no schedule."),
  after: privacyState.describe("The privacy and schedule Google reports after the change."),
  note: z
    .string()
    .nullable()
    .describe("Set when Google reports something other than what was asked: what it reports, and where to check."),
})

export type VideoPrivacy = (typeof VIDEO_PRIVACIES)[number]
export type YoutubePrivacyArgs = z.output<typeof youtubePrivacyInput>
export type YoutubePrivacyResult = z.input<typeof youtubePrivacyOutput>
export type PrivacyState = z.output<typeof privacyState>
