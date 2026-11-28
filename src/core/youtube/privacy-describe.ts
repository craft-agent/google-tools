import type { CallDescription } from "../tool"
import { playlistPin } from "./playlist-state"
import type { VideoPrivacy } from "./privacy-args"
import type { PlaylistPrivacyPlan, PrivacyPlan, VideoPrivacyPlan } from "./privacy-plan"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/** The headline of a change of a video to each privacy a call can ask for. */
const HEADLINES: Readonly<Record<VideoPrivacy, string>> = {
  public: YOUTUBE_WORDS.makePublic,
  unlisted: YOUTUBE_WORDS.makeUnlisted,
  private: YOUTUBE_WORDS.makePrivate,
}

/** The headline of a change of a playlist to each privacy a call can ask for. */
const PLAYLIST_HEADLINES: Readonly<Record<VideoPrivacy, string>> = {
  public: YOUTUBE_WORDS.makePlaylistPublic,
  unlisted: YOUTUBE_WORDS.makePlaylistUnlisted,
  private: YOUTUBE_WORDS.makePlaylistPrivate,
}

/** The description of a change of a video: the privacy asked for, or the time it goes public. */
function describeVideoPrivacy({ before, requested }: VideoPrivacyPlan): CallDescription {
  const title = before.snippet.title
  return {
    headline:
      requested.publish_at === null
        ? { text: HEADLINES[requested.privacy], values: { title } }
        : { text: YOUTUBE_WORDS.schedule, values: { title, time: requested.publish_at } },
    facts: [privacyFact(YOUTUBE_WORDS.now, before.status)],
    pins: { video: statePin(before) },
  }
}

/** The description of a change of a playlist, which has no schedule. */
function describePlaylistPrivacy({ before, requested }: PlaylistPrivacyPlan): CallDescription {
  return {
    headline: { text: PLAYLIST_HEADLINES[requested.privacy], values: { title: before.snippet.title } },
    facts: [privacyFact(YOUTUBE_WORDS.now, before.status)],
    pins: { playlist: playlistPin(before) },
  }
}

/**
 * What the prompt shows of a privacy change: the headline with the video's or
 * playlist's title as Google has it and the privacy asked for (or the time a
 * video goes public), and who can watch it now. The pin holds every writable
 * property the plan read, so a video or a playlist changed after the prompt is
 * `stale`.
 */
export function describePrivacy(plan: PrivacyPlan): CallDescription {
  return plan.kind === "video" ? describeVideoPrivacy(plan) : describePlaylistPrivacy(plan)
}
