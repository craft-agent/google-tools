import { cut } from "../describe"
import type { CallFact } from "../tool"
import type { CommentFile } from "./file"
import { COMMENTS_WORDS } from "./words"

/** How many characters of a thread's text the prompt shows beside its author. */
const MAX_THREAD_CHARACTERS = 80

/** The pin that holds the words of the post a prompt was drawn for, which an edit replaces and a delete removes. */
export const POST_TEXT_PIN = "post_text"

/** `text` on one line: runs of whitespace become one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** The author and the start of the text on one line, the text cut to `MAX_THREAD_CHARACTERS`; the text alone when the author is unknown. */
export function authoredStart(author: string | null, text: string): string {
  const start = cut(oneLine(text), MAX_THREAD_CHARACTERS)
  return author === null ? start : `${author}: ${start}`
}

/** The `At` fact: the cell a spreadsheet's thread is anchored to; none for a thread with no cell. */
export function atFacts(at: string | null): CallFact[] {
  return at === null ? [] : [{ label: COMMENTS_WORDS.at, value: at }]
}

/** The file as the headline names it: its name as Google has it, else its id. */
export function fileName(file: Pick<CommentFile, "name" | "fileId">): string {
  return file.name || file.fileId
}
