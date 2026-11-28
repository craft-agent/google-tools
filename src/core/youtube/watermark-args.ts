import { z } from "zod"
import { accountArg } from "../sheets/schemas"

/** Where a watermark's timing is counted from: the start of every video, or its end. */
export const WATERMARK_ANCHORS = ["start", "end"] as const

export type WatermarkAnchor = (typeof WATERMARK_ANCHORS)[number]

export const youtubeWatermarkSetInput = z.strictObject({
  account: accountArg,
  path: z
    .string()
    .min(1)
    .describe(
      "The image to set: an absolute path inside the upload directories a person set up (none by default), a JPEG or PNG file of at most 10 MB. A link, a hard-linked file or a file outside them is refused.",
    ),
  from: z
    .enum(WATERMARK_ANCHORS)
    .optional()
    .describe(
      "Where `offset_seconds` is counted from: `start` (the default) or `end` of each video. With `end`, `offset_seconds` is required.",
    ),
  offset_seconds: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "When the watermark appears, in whole seconds after the start of each video (default 0, which is from the beginning) or, with `from` `end`, before its end (at least 1, required).",
    ),
  duration_seconds: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "How long the watermark stays, in whole seconds; by default until the end of the video. With `from` `end`, at most `offset_seconds`.",
    ),
})

export const youtubeWatermarkSetOutput = z.object({
  channel_id: z.string(),
  shown: z
    .object({
      from: z.enum(WATERMARK_ANCHORS),
      offset_seconds: z.number().int(),
      duration_seconds: z.number().int().nullable().describe("`null` when the watermark stays until the end."),
    })
    .describe("When the watermark was asked to appear, as the call set it: the default is the whole video."),
  note: z.string().describe("Where YouTube shows the watermark."),
})

export const youtubeWatermarkRemoveInput = z.strictObject({ account: accountArg })

export const youtubeWatermarkRemoveOutput = z.object({
  channel_id: z.string(),
  removed: z.literal(true),
})

export type YoutubeWatermarkSetArgs = z.output<typeof youtubeWatermarkSetInput>
export type YoutubeWatermarkSetResult = z.input<typeof youtubeWatermarkSetOutput>
export type YoutubeWatermarkRemoveArgs = z.output<typeof youtubeWatermarkRemoveInput>
export type YoutubeWatermarkRemoveResult = z.input<typeof youtubeWatermarkRemoveOutput>
