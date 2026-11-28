import { sizeFact } from "../facts"
import type { CallDescription } from "../tool"
import type { ThumbnailPlan } from "./thumbnail-plan"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/** The pin that holds the SHA-256 of the image's content. */
const CONTENT_PIN = "content"

/**
 * What the prompt shows of a thumbnail change: the headline with the video's
 * title as Google has it, who can watch the video now (a public video's
 * viewers see the new thumbnail at once), and the image's real path, size and
 * type. The image's SHA-256 and the video's writable properties are pins, so
 * a file or a video changed after the prompt is `stale`.
 */
export function describeThumbnail({ state, file, image }: ThumbnailPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.thumbnail, values: { title: state.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, state.status),
      { label: YOUTUBE_WORDS.from, value: file.path },
      sizeFact(file.size),
      { label: YOUTUBE_WORDS.type, value: image.name },
    ],
    pins: { [CONTENT_PIN]: file.sha256, video: statePin(state) },
  }
}
