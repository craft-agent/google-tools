import { ToolError, isToolError } from "../errors"
import { defineTool, type ToolContext } from "../tool"
import { youtubeError } from "./errors"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_TOOLSET } from "./scopes"
import { ownChannelTargets } from "./target"
import {
  youtubeWatermarkRemoveInput,
  youtubeWatermarkRemoveOutput,
  type YoutubeWatermarkRemoveArgs,
  type YoutubeWatermarkRemoveResult,
} from "./watermark-args"
import { describeWatermarkRemove } from "./watermark-remove-describe"
import { planWatermarkRemove } from "./watermark-remove-plan"

/** What a `not_found` of the removal goes on to say: Google answers it for a channel with no watermark too. */
const NO_WATERMARK_SENTENCE = " The channel may have no watermark."

/** `error` as the removal reports it: a `not_found` from Google goes on to say the channel may have no watermark. */
function unsetError(error: unknown): unknown {
  const reported = youtubeError(error)
  return isToolError(reported) && reported.code === "not_found"
    ? new ToolError("not_found", `${reported.message}${NO_WATERMARK_SENTENCE}`, {
        cause: reported,
        details: reported.details,
      })
    : reported
}

/** Takes the channel's watermark off; Google answers 204 and nothing more. */
export async function removeWatermark(
  args: YoutubeWatermarkRemoveArgs,
  ctx: ToolContext,
): Promise<YoutubeWatermarkRemoveResult> {
  const { session, channel } = await planWatermarkRemove(args, ctx)
  try {
    await session.client.request(YOUTUBE_ROUTES.watermarksUnset, { query: { channelId: channel.id } })
  } catch (error) {
    throw unsetError(error)
  }
  return { channel_id: channel.id, removed: true }
}

export const googleYoutubeWatermarkRemove = defineTool({
  id: "google_youtube_watermark_remove",
  title: "Remove YouTube watermark",
  intent: "About to remove a YouTube channel's watermark",
  description:
    "Take the watermark off the account's own YouTube channel, so no video of the channel shows it any more; the viewers of a public video see it gone at once. " +
    "Google does not say whether the channel has a watermark, so the prompt cannot show it, and a channel with none may answer `not_found`. " +
    "To set one use `google_youtube_watermark_set`. " +
    "Returns the `channel_id` and `removed`. " +
    "Quota: 50 units for the removal and 1 for the channel read before it; the quota resets at midnight Pacific time. " +
    "`account` is needed when several accounts are set up.",
  toolset: YOUTUBE_TOOLSET,
  class: "overwrite",
  input: youtubeWatermarkRemoveInput,
  output: youtubeWatermarkRemoveOutput,
  targets: (args, ctx) => ownChannelTargets(args.account, ctx, YOUTUBE_ROUTES.watermarksUnset),
  async describe(args, ctx) {
    return describeWatermarkRemove(await planWatermarkRemove(args, ctx))
  },
  execute: (args, ctx) => removeWatermark(args, ctx),
})
