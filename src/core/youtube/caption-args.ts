import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { captionSchema } from "./caption-view"
import { MAX_CAPTION_NAME_CHARACTERS } from "./checks"
import { videoArg } from "./write-args"

/** The most bytes of a caption file, as Google counts them: 100 MB. */
export const MAX_CAPTION_BYTES = 100 * 1000 * 1000

/** The extensions of the caption formats Google takes. */
export const CAPTION_EXTENSIONS = [".srt", ".vtt", ".sbv", ".ttml", ".dfxp", ".scc"] as const

const fileHelp = `an absolute path inside the upload directories a person set up (none by default): a caption file with its own timings (${CAPTION_EXTENSIONS.join(", ")}) of at most ${MAX_CAPTION_BYTES / 1_000_000} MB. A link, a hard-linked file or a file outside them is refused.`

export const youtubeCaptionAddInput = z.strictObject({
  account: accountArg,
  video: videoArg,
  path: z.string().min(1).describe(`The caption file: ${fileHelp}`),
  language: z.string().describe("The track's language, as a language tag such as `en`, `ja` or `pt-BR`."),
  name: z
    .string()
    .optional()
    .describe(
      `The track's name, shown in the player's menu: 0 to ${MAX_CAPTION_NAME_CHARACTERS} characters, without control characters; default empty.`,
    ),
  draft: z
    .boolean()
    .optional()
    .describe("Whether the track is a draft, which viewers do not see; default false, so viewers see it at once."),
})

export const youtubeCaptionAddOutput = z.object({
  video_id: z.string(),
  caption: captionSchema.describe("The new track as Google reports it."),
})

export const youtubeCaptionUpdateInput = z.strictObject({
  account: accountArg,
  video: videoArg,
  caption: z
    .string()
    .describe(
      "The track's id, as `google_youtube_read` method `captions` gives it (`caption_id`). It must be one of the video's.",
    ),
  path: z.string().min(1).optional().describe(`The track's new file, replacing the one it has: ${fileHelp}`),
  draft: z
    .boolean()
    .optional()
    .describe("Whether the track is a draft, which viewers do not see; leave out to keep the track's own."),
})

export const youtubeCaptionUpdateOutput = z.object({
  video_id: z.string(),
  before: captionSchema.describe("The track as it was before the change."),
  caption: captionSchema.describe("The track as Google reports it after the change."),
})

export type YoutubeCaptionAddArgs = z.output<typeof youtubeCaptionAddInput>
export type YoutubeCaptionAddResult = z.input<typeof youtubeCaptionAddOutput>
export type YoutubeCaptionUpdateArgs = z.output<typeof youtubeCaptionUpdateInput>
export type YoutubeCaptionUpdateResult = z.input<typeof youtubeCaptionUpdateOutput>
