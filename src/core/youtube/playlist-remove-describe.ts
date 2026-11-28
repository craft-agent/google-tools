import type { CallDescription } from "../tool"
import { itemPin } from "./own-playlist-item"
import { positionText } from "./playlist-facts"
import type { PlaylistRemovePlan } from "./playlist-remove-plan"
import { playlistPin } from "./playlist-state"
import { privacyFact } from "./video-facts"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a removal: the headline with the video's and the
 * playlist's titles as Google has them, who can watch the playlist now (a
 * removal from a public playlist is seen at once) and where the entry is. The
 * pins hold the playlist's writable properties and the entry as it was read, so
 * a playlist or an entry changed after the prompt is `stale`.
 */
export function describePlaylistRemove({ state, item }: PlaylistRemovePlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.playlistRemove, values: { video: item.title, playlist: state.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, state.status),
      { label: YOUTUBE_WORDS.position, value: positionText(item.position) },
    ],
    pins: { playlist: playlistPin(state), item: itemPin(item) },
  }
}
