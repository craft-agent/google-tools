import { phrase } from "../run/facts"
import type { CallDescription, CallFact } from "../tool"
import { digestOf } from "./comment-facts"
import type { PlaylistAddPlan } from "./playlist-add-plan"
import { entriesFacts, positionText } from "./playlist-facts"
import { playlistPin } from "./playlist-state"
import { privacyFact } from "./video-facts"
import { YOUTUBE_WORDS } from "./words"

/** Who made the video, when it is not the label's own channel: its channel's title as Google gives it, else its id. */
function videoByFacts({ video, channel }: Pick<PlaylistAddPlan, "video" | "channel">): CallFact[] {
  if (video.channelId === channel) return []
  const by = video.channelTitle ?? video.channelId
  return by === undefined ? [] : [{ label: YOUTUBE_WORDS.videoBy, value: by }]
}

/**
 * What the prompt shows of an add: the headline with the video's and the
 * playlist's titles as Google has them, who can watch the playlist now (an
 * entry in a public playlist is seen at once), where the entry goes and how
 * many there are now, whose video it is when not the channel's own, and the
 * note as the text. The pins hold the playlist's writable properties and the
 * video as it was read, so a playlist or a video changed after the prompt is
 * `stale`.
 */
export function describePlaylistAdd(plan: PlaylistAddPlan): CallDescription {
  const { state, video, position, note } = plan
  return {
    headline: { text: YOUTUBE_WORDS.playlistAdd, values: { video: video.title, playlist: state.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, state.status),
      {
        label: YOUTUBE_WORDS.position,
        value: position === undefined ? phrase(YOUTUBE_WORDS.positionEnd) : positionText(position),
      },
      ...entriesFacts(state.itemCount),
      ...videoByFacts(plan),
    ],
    ...(note !== undefined && note !== "" ? { text: { label: YOUTUBE_WORDS.note, body: note } } : {}),
    pins: { playlist: playlistPin(state), video: digestOf(video) },
  }
}
