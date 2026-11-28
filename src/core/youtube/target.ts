import type { Route } from "../google/routes"
import type { ToolContext } from "../tool"
import { videoId } from "./ids"
import { youtubeWriteSession } from "./write-session"

/** The target of a write to a video of the label's channel: the label, then the video's path (`videos`, its id). */
export function videoTarget(label: string, video: string): string {
  return [label, "videos", video].join("/")
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
