import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { playlistId, playlistItemId } from "./ids"
import { ownPlaylist } from "./own-playlist"
import { ownPlaylistItem, type PlaylistItemState } from "./own-playlist-item"
import type { YoutubePlaylistRemoveArgs } from "./playlist-item-args"
import type { PlaylistState } from "./playlist-state"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** A removal planned: the playlist and the entry as they were read. */
export type PlaylistRemovePlan = {
  session: GoogleSession
  playlist: string
  /** The playlist as it was read. */
  state: PlaylistState
  /** The entry as it was read. */
  item: PlaylistItemState
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the label's channel and the playlist, which must be the channel's own,
 * and the entry, which must be the playlist's.
 */
export async function planPlaylistRemove(
  args: YoutubePlaylistRemoveArgs,
  ctx: ToolContext,
): Promise<PlaylistRemovePlan> {
  const playlist = playlistId(args.playlist)
  const itemId = playlistItemId(args.item)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistItemsDelete)
  const { state } = await ownPlaylist(session, playlist)
  return { session, playlist, state, item: await ownPlaylistItem(session, playlist, itemId) }
}
