import { phrase } from "../run/facts"
import type { CallFact, CallValue } from "../tool"
import type { VideoStatus } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/** The words of the privacies Google names, which a prompt shows in the tool's language. */
const PRIVACY_WORDS: ReadonlyMap<string, string> = new Map([
  ["public", YOUTUBE_WORDS.public],
  ["unlisted", YOUTUBE_WORDS.unlisted],
  ["private", YOUTUBE_WORDS.private],
])

/** Who can watch a video now: its privacy, or `private until <time>` while a schedule is set; a privacy Google names otherwise as it is. */
export function privacyValue({ privacyStatus, publishAt }: VideoStatus): string | CallValue {
  if (privacyStatus === "private" && publishAt !== undefined) {
    return { text: YOUTUBE_WORDS.privateUntil, values: { time: publishAt } }
  }
  const word = PRIVACY_WORDS.get(privacyStatus)
  return word === undefined ? privacyStatus : phrase(word)
}

/** The fact that says who can watch the video now, under `label`. */
export function privacyFact(label: string, status: VideoStatus): CallFact {
  return { label, value: privacyValue(status) }
}
