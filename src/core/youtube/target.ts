import type { Route } from "../google/routes"
import type { ToolContext } from "../tool"
import { captionId, videoId } from "./ids"
import { youtubeWriteSession } from "./write-session"

/** The target of a write to a video of the label's channel: the label, then the video's path (`videos`, its id). */
export function videoTarget(label: string, video: string): string {
  return [label, "videos", video].join("/")
}

/** The target of a write to a caption track of a video of the label's channel: the video's target, then the track's path (`captions`, its id). */
export function captionTarget(label: string, video: string, caption: string): string {
  return [videoTarget(label, video), "captions", caption].join("/")
}

/** The target of a write that makes a video in the label's channel: the label, then the channel's path (`channels`, its id). */
export function channelTarget(label: string, channel: string): string {
  return [label, "channels", channel].join("/")
}

/** The one target of a write to a video: the id is checked first, then the label's scopes, those of the route `write` the call sends. */
export async function videoTargets(
  args: { account?: string; video: string },
  ctx: ToolContext,
  write: Route,
): Promise<string[]> {
  const video = videoId(args.video)
  const { label } = await youtubeWriteSession(ctx, args.account, write)
  return [videoTarget(label, video)]
}

/** The one target of a write to a caption track: the ids are checked first, then the label's scopes, those of the route `write` the call sends. */
export async function captionTargets(
  args: { account?: string; video: string; caption: string },
  ctx: ToolContext,
  write: Route,
): Promise<string[]> {
  const video = videoId(args.video)
  const caption = captionId(args.caption)
  const { label } = await youtubeWriteSession(ctx, args.account, write)
  return [captionTarget(label, video, caption)]
}
