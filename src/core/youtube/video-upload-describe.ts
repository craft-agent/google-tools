import { sizeFact } from "../facts"
import { phrase } from "../run/facts"
import type { CallDescription } from "../tool"
import type { VideoUploadPlan } from "./video-upload-plan"
import { YOUTUBE_WORDS } from "./words"

/** The pin that holds the SHA-256 of the video file's content. */
const CONTENT_PIN = "content"

/** The pin that holds the id of the channel the video is made in. */
const CHANNEL_PIN = "channel"

/**
 * What the prompt shows of an upload: the call's title in the headline (the
 * video does not exist yet), that it goes up private, the made-for-kids
 * declaration, the file's real path, size and type, and the description as
 * the text. The file's SHA-256 and the channel's id are pins, so a file or a
 * channel that changed after the prompt is `stale`.
 */
export function describeVideoUpload({
  title,
  description,
  madeForKids,
  file,
  mimeType,
  channel,
}: VideoUploadPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.videoUpload, values: { title } },
    facts: [
      { label: YOUTUBE_WORDS.privacy, value: phrase(YOUTUBE_WORDS.private) },
      { label: YOUTUBE_WORDS.madeForKids, value: phrase(madeForKids ? YOUTUBE_WORDS.yes : YOUTUBE_WORDS.no) },
      { label: YOUTUBE_WORDS.from, value: file.path },
      sizeFact(file.size),
      { label: YOUTUBE_WORDS.type, value: mimeType },
    ],
    ...(description !== undefined && description !== ""
      ? { text: { label: YOUTUBE_WORDS.description, body: description } }
      : {}),
    pins: { [CONTENT_PIN]: file.sha256, [CHANNEL_PIN]: channel },
  }
}
