import { sizeFact } from "../facts"
import { phrase } from "../run/facts"
import type { CallDescription, CallFact, CallValue } from "../tool"
import type { CaptionFile } from "./caption-file"
import { YOUTUBE_WORDS } from "./words"

/** The pin that holds the SHA-256 of the caption file's content. */
export const CONTENT_PIN = "content"

/** Whether a track is a draft, in the words of a prompt: `yes, viewers do not see it` or `no`. */
export function draftValue(draft: boolean): CallValue {
  return phrase(draft ? YOUTUBE_WORDS.draftYes : YOUTUBE_WORDS.no)
}

/** The facts that say where the caption file is and how large: its real path and size. */
export function fileFacts({ path, size }: CaptionFile): CallFact[] {
  return [{ label: YOUTUBE_WORDS.from, value: path }, sizeFact(size)]
}

/** The text of the prompt: the file as UTF-8 under `Captions`, or none for an empty file. */
export function captionText({ text }: CaptionFile): Pick<CallDescription, "text"> {
  return text === "" ? {} : { text: { label: YOUTUBE_WORDS.captions, body: text } }
}
