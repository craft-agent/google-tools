import type { CallDescription } from "../tool"
import { itemPin } from "./own-playlist-item"
import { positionText } from "./playlist-facts"
import type { PlaylistMovePlan } from "./playlist-move-plan"
import { playlistPin } from "./playlist-state"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a move: the headline with the video's and the
 * playlist's titles as Google has them, and where the entry is and goes. The
 * pins hold the playlist's writable properties and the entry as it was read, so
 * a playlist or an entry changed after the prompt is `stale`.
 */
export function describePlaylistMove({ state, item, position }: PlaylistMovePlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.playlistMove, values: { video: item.title, playlist: state.snippet.title } },
    facts: [
      { label: YOUTUBE_WORDS.positionNow, value: positionText(item.position) },
      { label: YOUTUBE_WORDS.positionNew, value: positionText(position) },
    ],
    pins: { playlist: playlistPin(state), item: itemPin(item) },
  }
}
