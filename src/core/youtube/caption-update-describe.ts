import type { CallDescription } from "../tool"
import { CONTENT_PIN, captionText, draftValue, fileFacts } from "./caption-facts"
import type { CaptionUpdatePlan } from "./caption-update-plan"
import { trackPin } from "./caption-calls"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/** The language a headline names when Google gave the track none. */
const UNKNOWN_LANGUAGE = "unknown"

/** The headline of the change: a new file, else a track published or made a draft. */
function headlineText({ file, draft }: Pick<CaptionUpdatePlan, "file" | "draft">): string {
  if (file !== undefined) return YOUTUBE_WORDS.captionReplace
  return draft ? YOUTUBE_WORDS.captionDraft : YOUTUBE_WORDS.captionPublish
}

/**
 * What the prompt shows of a caption update: the headline with the track's
 * language and the video's title as Google has it, who can watch the video now,
 * whether the track is a draft now and after, the track's name and last update,
 * and, when a file goes, its real path, size and text. The pins hold the file's
 * SHA-256, the video's writable properties and the track as it was read, so a
 * file, a video or a track changed after the prompt is `stale`.
 */
export function describeCaptionUpdate(plan: CaptionUpdatePlan): CallDescription {
  const { state, track, file, draft } = plan
  return {
    headline: {
      text: headlineText(plan),
      values: { language: track.language ?? UNKNOWN_LANGUAGE, title: state.snippet.title },
    },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, state.status),
      { label: YOUTUBE_WORDS.draftNow, value: draftValue(track.draft ?? false) },
      { label: YOUTUBE_WORDS.draftAfter, value: draftValue(draft) },
      { label: YOUTUBE_WORDS.track, value: track.name ?? "" },
      { label: YOUTUBE_WORDS.updated, value: track.updated_at ?? "" },
      ...(file === undefined ? [] : fileFacts(file)),
    ],
    ...(file === undefined ? {} : captionText(file)),
    pins: {
      ...(file !== undefined && { [CONTENT_PIN]: file.sha256 }),
      video: statePin(state),
      track: trackPin(track),
    },
  }
}
