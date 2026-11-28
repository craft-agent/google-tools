import { phrase } from "../run/facts"
import type { CallDescription } from "../tool"
import type { PlaylistCreatePlan } from "./playlist-create-plan"
import { YOUTUBE_WORDS } from "./words"

/** The pin that holds the id of the channel the playlist is made in. */
const CHANNEL_PIN = "channel"

/**
 * What the prompt shows of a new playlist: the call's title in the headline
 * (the playlist does not exist yet), that it is made private, and the
 * description as the text. The channel's id is a pin, so a channel that changed
 * after the prompt is `stale`.
 */
export function describePlaylistCreate({ title, description, channel }: PlaylistCreatePlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.playlistCreate, values: { title } },
    facts: [{ label: YOUTUBE_WORDS.privacy, value: phrase(YOUTUBE_WORDS.private) }],
    ...(description !== undefined && description !== ""
      ? { text: { label: YOUTUBE_WORDS.description, body: description } }
      : {}),
    pins: { [CHANNEL_PIN]: channel },
  }
}
