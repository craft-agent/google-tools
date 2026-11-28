import type { CallDescription } from "../tool"
import type { CaptionAddPlan } from "./caption-add-plan"
import { CONTENT_PIN, captionText, draftValue, fileFacts } from "./caption-facts"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a new caption track: the headline with the language
 * and the video's title as Google has it, who can watch the video now (a
 * non-draft track on a public video is seen at once), whether the track is a
 * draft, how many tracks the video has in that language already, the file's
 * real path and size, and the file's text. The file's SHA-256 and the video's
 * writable properties are pins, so a file or a video changed after the prompt
 * is `stale`.
 */
export function describeCaptionAdd({ state, file, language, draft, inLanguage }: CaptionAddPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.captionAdd, values: { language, title: state.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, state.status),
      { label: YOUTUBE_WORDS.draft, value: draftValue(draft) },
      {
        label: YOUTUBE_WORDS.sameLanguage,
        value: {
          text: inLanguage === 1 ? YOUTUBE_WORDS.tracksOne : YOUTUBE_WORDS.tracksMany,
          values: { count: inLanguage },
        },
      },
      ...fileFacts(file),
    ],
    ...captionText(file),
    pins: { [CONTENT_PIN]: file.sha256, video: statePin(state) },
  }
}
