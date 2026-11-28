import { ToolError } from "../errors"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { listVideos } from "./calls"
import { checkedPlaylistNote } from "./checks"
import { youtubeError } from "./errors"
import { playlistId, videoId } from "./ids"
import { ownPlaylist } from "./own-playlist"
import { videoResourceId } from "./own-playlist-item"
import type { YoutubePlaylistAddArgs } from "./playlist-item-args"
import type { PlaylistState } from "./playlist-state"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** The parts of the video a playlist add reads: the title and the channel for the prompt, the privacy for who can see the entry. */
const ADDED_VIDEO_PARTS = "snippet,status"

/** The video to add as the prompt shows and pins it: any channel's, as Google gives it. */
export type AddedVideo = {
  id: string
  title: string
  channelId: string | undefined
  channelTitle: string | undefined
  privacy: string | undefined
}

/** An add planned: the playlist and the video as they were read, and the request's parts and body. */
export type PlaylistAddPlan = {
  session: GoogleSession
  playlist: string
  /** The playlist as it was read. */
  state: PlaylistState
  /** The id of the label's channel, whose the playlist is. */
  channel: string
  video: AddedVideo
  position: number | undefined
  note: string | undefined
  /** The parts sent, in the order `part` lists them. */
  parts: string
  /** The body of the insert: the entry's playlist, video and position, and its note when there is one. */
  body: Record<string, unknown>
}

/** The video `id` as `videos.list` gives it, if it does, and who can see it; one Google does not return is `not_found`. */
async function readVideo(session: GoogleSession, id: string): Promise<AddedVideo> {
  let found
  try {
    found = (await listVideos(session.client, [id], ADDED_VIDEO_PARTS)).find((video) => video.id === id)
  } catch (error) {
    throw youtubeError(error)
  }
  if (found === undefined) {
    throw new ToolError("not_found", `Video ${id} was not found, or the account cannot see it.`)
  }
  const { snippet, status } = found
  if (snippet?.title === undefined) {
    throw new ToolError("upstream_error", "Google's reply to the video list was not in the expected shape.")
  }
  return {
    id,
    title: snippet.title,
    channelId: snippet.channelId,
    channelTitle: snippet.channelTitle,
    privacy: status?.privacyStatus,
  }
}

/**
 * Checks the arguments (ids, the note's limit) and the label's scopes before
 * anything is read, then reads the label's channel and the playlist, which
 * must be the channel's own, and the video, which may be any the account can
 * see; one Google does not return is `not_found`.
 */
export async function planPlaylistAdd(args: YoutubePlaylistAddArgs, ctx: ToolContext): Promise<PlaylistAddPlan> {
  const playlist = playlistId(args.playlist)
  const video = videoId(args.video)
  const note = args.note === undefined ? undefined : checkedPlaylistNote(args.note)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistItemsInsert)
  const { channelId, state } = await ownPlaylist(session, playlist)
  const added = await readVideo(session, video)
  return {
    session,
    playlist,
    state,
    channel: channelId,
    video: added,
    position: args.position,
    note,
    parts: note === undefined ? "snippet" : "snippet,contentDetails",
    body: {
      snippet: {
        playlistId: playlist,
        resourceId: videoResourceId(video),
        ...(args.position !== undefined && { position: args.position }),
      },
      ...(note !== undefined && { contentDetails: { note } }),
    },
  }
}
