import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { videoArg } from "./write-args"

export const youtubeThumbnailInput = z.strictObject({
  account: accountArg,
  video: videoArg,
  path: z
    .string()
    .min(1)
    .describe(
      "The image to set: an absolute path inside the upload directories a person set up (none by default), a JPEG or PNG file of at most 50 MB. A link, a hard-linked file or a file outside them is refused.",
    ),
})

const thumbnailSize = z
  .object({
    url: z.string(),
    width: z.number().nullable().describe("Its width in pixels; null when Google gave none."),
    height: z.number().nullable().describe("Its height in pixels; null when Google gave none."),
  })
  .nullable()

export const youtubeThumbnailOutput = z.object({
  video_id: z.string(),
  url: z.string().describe("The video's watch address."),
  thumbnails: z
    .object({
      default: thumbnailSize,
      medium: thumbnailSize,
      high: thumbnailSize,
      standard: thumbnailSize,
      maxres: thumbnailSize,
    })
    .describe("The thumbnail's addresses Google reports, each with its size; null for a size Google gave none of."),
})

export type YoutubeThumbnailArgs = z.output<typeof youtubeThumbnailInput>
export type YoutubeThumbnailResult = z.input<typeof youtubeThumbnailOutput>
