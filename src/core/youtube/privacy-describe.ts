import type { CallDescription } from "../tool"
import type { VideoPrivacy } from "./privacy-args"
import type { PrivacyPlan } from "./privacy-plan"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/** The headline of a change to each privacy a call can ask for. */
const HEADLINES: Readonly<Record<VideoPrivacy, string>> = {
  public: YOUTUBE_WORDS.makePublic,
  unlisted: YOUTUBE_WORDS.makeUnlisted,
  private: YOUTUBE_WORDS.makePrivate,
}

/**
 * What the prompt shows of a privacy change: the headline with the video's
 * title as Google has it and the privacy asked for (or the time it goes public),
 * and who can watch the video now. The pin holds every writable property the
 * plan read, so a video changed after the prompt is `stale`.
 */
export function describePrivacy({ before, requested }: PrivacyPlan): CallDescription {
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
