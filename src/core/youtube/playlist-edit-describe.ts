import type { CallDescription } from "../tool"
import type { PlaylistEditPlan } from "./playlist-edit-plan"
import { playlistPin } from "./playlist-state"
import { newValuesText } from "./video-edit-describe"
import { privacyFact } from "./video-facts"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a playlist edit: the headline with the playlist's
 * title as Google has it, who can watch it now, the fields that change, and a
 * line for each new value with the description last. The pin holds every
 * writable property the edit read, so a playlist changed after the prompt is
 * `stale`.
 */
export function describePlaylistEdit({ before, changes }: PlaylistEditPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.playlistEdit, values: { title: before.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, before.status),
      { label: YOUTUBE_WORDS.fields, value: changes.map(({ field }) => field).join(", ") },
    ],
    text: newValuesText(changes),
    pins: { playlist: playlistPin(before) },
  }
}
