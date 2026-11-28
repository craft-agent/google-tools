import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { videoArg } from "./write-args"

/** The privacies a video can be set to. */
export const VIDEO_PRIVACIES = ["private", "unlisted", "public"] as const

export const youtubePrivacyInput = z.strictObject({
  account: accountArg,
  video: videoArg,
  privacy: z
    .enum(VIDEO_PRIVACIES)
    .optional()
    .describe(
      "`private` (only the channel; it also clears a schedule), `unlisted` (anyone with the link) or `public` (everyone, at once). Give this or `publish_at`, not both.",
    ),
  publish_at: z
    .string()
    .optional()
    .describe(
      "Schedules the video: it stays private and goes public at this time, an RFC 3339 time in the future with its offset, such as `2026-12-24T09:00:00+09:00`. Give this or `privacy`, not both.",
    ),
})

const privacyState = z.object({
  privacy: z.string().nullable().describe("`private`, `unlisted` or `public`; null when Google gave none."),
  publish_at: z.string().nullable().describe("When a private video goes public, in UTC; null when none is set."),
})

export const youtubePrivacyOutput = z.object({
  video_id: z.string(),
  url: z.string(),
  requested: privacyState.describe("What the call asked for."),
  before: privacyState.describe("The privacy and schedule the video had."),
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
