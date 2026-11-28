import { UPLOAD_TIMEOUT_MS } from "../files/resumable-send"
import { relatedUpload } from "../gmail/upload-body"
import { defineTool, type ToolContext } from "../tool"
import { youtubeError } from "./errors"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_TOOLSET } from "./scopes"
import { ownChannelTargets } from "./target"
import {
  youtubeWatermarkSetInput,
  youtubeWatermarkSetOutput,
  type YoutubeWatermarkSetArgs,
  type YoutubeWatermarkSetResult,
} from "./watermark-args"
import { describeWatermarkSet } from "./watermark-set-describe"
import { MAX_WATERMARK_BYTES, checkedTiming, planWatermarkSet, watermarkMetadata } from "./watermark-set-plan"

/** What the result says of where YouTube shows the watermark. */
const POSITION_NOTE = "YouTube shows the watermark in the upper right of every video of the channel."

/** Sets the channel's watermark from the image and returns when it was asked to be shown; Google answers 204 and nothing more. */
export async function setWatermark(
  args: YoutubeWatermarkSetArgs,
  ctx: ToolContext,
): Promise<YoutubeWatermarkSetResult> {
  const { session, channel, file, image, timing } = await planWatermarkSet(args, ctx)
  try {
    await session.client.request(YOUTUBE_ROUTES.watermarksSet, {
      query: { channelId: channel.id, uploadType: "multipart" },
      content: relatedUpload(watermarkMetadata(timing), file.bytes, image.mimeType),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  } catch (error) {
    throw youtubeError(error)
  }
  return {
    channel_id: channel.id,
    shown: { from: timing.from, offset_seconds: timing.offsetSeconds, duration_seconds: timing.durationSeconds },
    note: POSITION_NOTE,
  }
}

export const googleYoutubeWatermarkSet = defineTool({
  id: "google_youtube_watermark_set",
  title: "Set YouTube watermark",
  intent: "About to set a YouTube channel's watermark",
  description:
    "Set the watermark of the account's own YouTube channel from the image at `path`: a small image YouTube shows on every video of the channel, at once. " +
    "`from` (`start`, the default, or `end`), `offset_seconds` and `duration_seconds` set when it is shown; by default it is shown for the whole video. Counted from the `end`, `offset_seconds` (at least 1) is required and `duration_seconds` is at most that. " +
    `The file is read only from the upload directories a person set up (none by default), by its real path, never through a link; it must be a JPEG or PNG (\`.jpg\`, \`.jpeg\` or \`.png\`, and its content must be one) of at most ${MAX_WATERMARK_BYTES / 1_000_000} MB. A file under an \`encrypt_dirs\` directory is refused, since YouTube would hold only ciphertext, which no one could watch. ` +
    "It replaces the watermark the channel has, if any; Google does not say whether there is one, so this tool cannot tell what it replaces. " +
    "YouTube puts the watermark in the upper right and ignores a position, so none is offered. To take it off use `google_youtube_watermark_remove`. " +
    "Returns the `channel_id`, `shown` (`from`, `offset_seconds` and `duration_seconds`, null for until the end, as the call set them) and a `note` that says where YouTube shows it. " +
    "Quota: 50 units for the upload and 1 for the channel read before it; the quota resets at midnight Pacific time. " +
    "`account` is needed when several accounts are set up.",
  toolset: YOUTUBE_TOOLSET,
  class: "overwrite",
  input: youtubeWatermarkSetInput,
  output: youtubeWatermarkSetOutput,
  async targets(args, ctx) {
    checkedTiming(args)
    return ownChannelTargets(args.account, ctx, YOUTUBE_ROUTES.watermarksSet)
  },
  async describe(args, ctx) {
    return describeWatermarkSet(await planWatermarkSet(args, ctx))
  },
  execute: (args, ctx) => setWatermark(args, ctx),
})
