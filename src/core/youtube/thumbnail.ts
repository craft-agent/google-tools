import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import { parseReply } from "../sheets/reply"
import { defineTool, type ToolContext } from "../tool"
import { youtubeError } from "./errors"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_TOOLSET } from "./scopes"
import { videoTargets } from "./target"
import {
  youtubeThumbnailInput,
  youtubeThumbnailOutput,
  type YoutubeThumbnailArgs,
  type YoutubeThumbnailResult,
} from "./thumbnail-args"
import { describeThumbnail } from "./thumbnail-describe"
import { MAX_THUMBNAIL_BYTES, planThumbnail } from "./thumbnail-plan"
import { videoUrl } from "./views"

/** The time limit of the upload, in milliseconds: an image of up to 50 MB goes in one request. */
const UPLOAD_TIMEOUT_MS = 120_000

/** What a refused thumbnail goes on to say when the channel may not set custom thumbnails. */
const VERIFY_ADVICE = " If the channel may not set custom thumbnails, verify it in YouTube Studio (youtube.com/verify)."

const sizeReply = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() }).optional()

/** `thumbnails.set`'s reply: the thumbnails of the video, by size. */
const thumbnailReply = z.object({
  items: z
    .array(
      z.object({
        default: sizeReply,
        medium: sizeReply,
        high: sizeReply,
        standard: sizeReply,
        maxres: sizeReply,
      }),
    )
    .optional(),
})

/** One size of the thumbnail as the result gives it; null when Google reports none. */
function sized(size: z.output<typeof sizeReply>) {
  return size === undefined ? null : { url: size.url, width: size.width ?? null, height: size.height ?? null }
}

/** `error` as the thumbnail upload reports it: a `forbidden` from Google goes on to say how to let the channel set thumbnails. */
function thumbnailError(error: unknown): unknown {
  const reported = youtubeError(error)
  return isToolError(reported) && reported.code === "forbidden"
    ? new ToolError("forbidden", `${reported.message}${VERIFY_ADVICE}`, { cause: reported, details: reported.details })
    : reported
}

/** Sets the video's custom thumbnail from the image and returns the addresses Google reports for it. */
export async function setThumbnail(args: YoutubeThumbnailArgs, ctx: ToolContext): Promise<YoutubeThumbnailResult> {
  const plan = await planThumbnail(args, ctx)
  let reply: unknown
  try {
    reply = await plan.session.client.request(YOUTUBE_ROUTES.thumbnailsSet, {
      query: { videoId: plan.video, uploadType: "media" },
      content: { type: plan.image.mimeType, bytes: plan.file.bytes },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  } catch (error) {
    throw thumbnailError(error)
  }
  const [thumbnails] = parseReply(thumbnailReply, reply, "the thumbnail upload").items ?? []
  return {
    video_id: plan.video,
    url: videoUrl(plan.video),
    thumbnails: {
      default: sized(thumbnails?.default),
      medium: sized(thumbnails?.medium),
      high: sized(thumbnails?.high),
      standard: sized(thumbnails?.standard),
      maxres: sized(thumbnails?.maxres),
    },
  }
}

export const googleYoutubeThumbnailSet = defineTool({
  id: "google_youtube_thumbnail_set",
  title: "Set YouTube thumbnail",
  intent: "About to set a YouTube video's thumbnail",
  description:
    "Set the custom thumbnail of a video of the account's own YouTube channel, given by `video` (its id or address), from the image at `path`. " +
    `The file is read only from the upload directories a person set up (none by default), by its real path, never through a link; it must be a JPEG or PNG (\`.jpg\`, \`.jpeg\` or \`.png\`, and its content must be one) of at most ${MAX_THUMBNAIL_BYTES / 1_000_000} MB. A file under an \`encrypt_dirs\` directory is refused, since YouTube would hold only ciphertext, which no one could watch. ` +
    "Only the channel's own videos can be changed: a video of another channel is `forbidden` and nothing is sent; one that does not exist, or that the account cannot see, is `not_found`. " +
    "It replaces the thumbnail the video has, and the viewers of a public video see the new one at once. " +
    "A channel that may not set custom thumbnails gets `forbidden`: verify the channel in YouTube Studio (youtube.com/verify). " +
    "Returns the `video_id`, its `url` and the `thumbnails` Google reports (`default`, `medium`, `high`, `standard`, `maxres`: each an `url` with its `width` and `height`, or null). " +
    "Quota: 50 units for the upload and 1 each for the two reads before it (the channel and the video); the quota resets at midnight Pacific time. " +
    "`account` is needed when several accounts are set up.",
  toolset: YOUTUBE_TOOLSET,
  class: "overwrite",
  input: youtubeThumbnailInput,
  output: youtubeThumbnailOutput,
  targets: (args, ctx) => videoTargets(args, ctx, YOUTUBE_ROUTES.thumbnailsSet),
  async describe(args, ctx) {
    return describeThumbnail(await planThumbnail(args, ctx))
  },
  execute: (args, ctx) => setThumbnail(args, ctx),
})
