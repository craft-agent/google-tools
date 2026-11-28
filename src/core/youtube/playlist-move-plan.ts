import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { refusal } from "./checks"
import { playlistId, playlistItemId } from "./ids"
import { ownPlaylist } from "./own-playlist"
import { ownPlaylistItem, videoResourceId, type PlaylistItemState } from "./own-playlist-item"
import type { YoutubePlaylistMoveArgs } from "./playlist-item-args"
import type { PlaylistState } from "./playlist-state"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** A move planned: the playlist and the entry as they were read, and the request's parts and body. */
export type PlaylistMovePlan = {
  session: GoogleSession
  playlist: string
  /** The playlist as it was read. */
  state: PlaylistState
  /** The entry as it was read. */
  item: PlaylistItemState
  /** Where the entry goes. */
  position: number
  /** The parts sent, in the order `part` lists them. */
  parts: string
  /** The body of the update: the entry's id, playlist and video, the new position and the note it has. */
  body: Record<string, unknown>
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the label's channel and the playlist, which must be the channel's own,
 * and the entry, which must be the playlist's. The update sends the entry back
 * whole, as read, with the new position, since it deletes the note it leaves
 * out; an entry that is at the position already is `invalid_argument`.
 */
export async function planPlaylistMove(args: YoutubePlaylistMoveArgs, ctx: ToolContext): Promise<PlaylistMovePlan> {
  const playlist = playlistId(args.playlist)
  const itemId = playlistItemId(args.item)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistItemsUpdate)
  const { state } = await ownPlaylist(session, playlist)
  const item = await ownPlaylistItem(session, playlist, itemId)
  if (item.position === args.position) throw refusal(`The entry is already at position ${args.position}`)
  return {
    session,
    playlist,
    state,
    item,
    position: args.position,
    parts: item.note === undefined ? "snippet" : "snippet,contentDetails",
    body: {
      id: item.id,
      snippet: { playlistId: playlist, resourceId: videoResourceId(item.videoId), position: args.position },
      ...(item.note !== undefined && { contentDetails: { note: item.note } }),
    },
  }
}
