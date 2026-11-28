import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { YOUTUBE_ROUTES } from "./routes"
import type { YoutubeWatermarkRemoveArgs } from "./watermark-args"
import { readWatermarkChannel, type WatermarkChannel } from "./watermark-channel"
import { youtubeWriteSession } from "./write-session"

/** A watermark removal planned: the label's channel, whose watermark goes. */
export type WatermarkRemovePlan = { session: GoogleSession; channel: WatermarkChannel }

/** Checks the label's scopes before anything is read, then reads the label's channel; an account with no channel is `not_found`. */
export async function planWatermarkRemove(
  args: YoutubeWatermarkRemoveArgs,
  ctx: ToolContext,
): Promise<WatermarkRemovePlan> {
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.watermarksUnset)
  return { session, channel: await readWatermarkChannel(session) }
}
