import { ToolError } from "../errors"
import { shown } from "../run/ids"
import { parseReply } from "../sheets/reply"
import { youtubeError } from "./errors"
import { ownChannel, type OwnSession } from "./own-calls"
import { PLAYLIST_STATE_PARTS, playlistState, playlistsStateList, type PlaylistState } from "./playlist-state"
import { YOUTUBE_ROUTES } from "./routes"

/**
 * The playlist the label's own channel holds, as the writes plan with it: the
 * channel's id and the playlist's writable parts. A playlist Google does not
 * return is `not_found`; one of another channel, and the channel's uploads
 * playlist, which YouTube keeps to the uploads themselves, are `forbidden`,
 * nothing sent, so a prompt never shows another channel's playlist as its
 * subject. Google's failures come out as `youtubeError` makes them.
 */
export async function ownPlaylist(
  session: OwnSession,
  playlist: string,
): Promise<{ channelId: string; state: PlaylistState }> {
  const channel = await fromGoogle(() => ownChannel(session, "contentDetails"))
  if (channel.contentDetails?.relatedPlaylists?.uploads === playlist) {
    throw new ToolError(
      "forbidden",
      `Playlist ${playlist} is the channel's uploads playlist, which YouTube keeps to the uploads themselves. Nothing was sent.`,
    )
  }
  const found = await fromGoogle(() => readPlaylist(session, playlist))
  if (found === undefined) {
    throw new ToolError("not_found", `Playlist ${playlist} was not found, or the account cannot see it.`)
  }
  if (found.snippet?.channelId !== channel.id) {
    throw new ToolError(
      "forbidden",
      `Playlist ${shown(found.snippet?.title ?? "")} (${playlist}) belongs to another channel; only the channel's own playlists can be changed. Nothing was sent.`,
    )
  }
  return { channelId: channel.id, state: playlistState(found) }
}

/** The playlist `id` as `playlists.list` gives it, if it does; Google does not list a channel's uploads playlist there. */
async function readPlaylist(session: OwnSession, id: string) {
  const reply = await session.client.request(YOUTUBE_ROUTES.playlists, { query: { part: PLAYLIST_STATE_PARTS, id } })
  return parseReply(playlistsStateList, reply, "the playlist list").items?.find((item) => item.id === id)
}

/** What `read` gives, with Google's failures as `youtubeError` makes them. */
async function fromGoogle<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw youtubeError(error)
  }
}
