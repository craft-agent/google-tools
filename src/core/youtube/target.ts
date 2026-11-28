import { isAbortError } from "../errors"
import type { Route } from "../google/routes"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { captionId, playlistId, videoId } from "./ids"
import { youtubeWriteSession } from "./write-session"

/** The target of a write to a video of the label's channel: the label, then the video's path (`videos`, its id). */
export function videoTarget(label: string, video: string): string {
  return [label, "videos", video].join("/")
}

/** The target of a write to a caption track of a video of the label's channel: the video's target, then the track's path (`captions`, its id). */
export function captionTarget(label: string, video: string, caption: string): string {
  return [videoTarget(label, video), "captions", caption].join("/")
}

/** The target of a write to a comment of a video of the label's channel: the video's target, then the comment's path (`comments`, its id). */
export function commentTarget(label: string, video: string, comment: string): string {
  return [videoTarget(label, video), "comments", comment].join("/")
}

/** The target of a write to a playlist of the label's channel, or to one of its entries: the label, then the playlist's path (`playlists`, its id). */
export function playlistTarget(label: string, playlist: string): string {
  return [label, "playlists", playlist].join("/")
}

/**
 * The targets `find` gives, which read Google to learn the video of each
 * comment; `*` when they cannot be told (Google refused, or the comment is not
 * there), since the call itself then fails with the reason. A call that was
 * cancelled stays cancelled.
 */
export async function foundTargets(ctx: ToolContext, find: () => Promise<string[]>): Promise<string[]> {
  try {
    return await find()
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
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

/** The one target of a write to a playlist or its entries: the id is checked first, then the label's scopes, those of the route `write` the call sends. */
export async function playlistTargets(
  args: { account?: string; playlist: string },
  ctx: ToolContext,
  write: Route,
): Promise<string[]> {
  const playlist = playlistId(args.playlist)
  const { label } = await youtubeWriteSession(ctx, args.account, write)
  return [playlistTarget(label, playlist)]
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
