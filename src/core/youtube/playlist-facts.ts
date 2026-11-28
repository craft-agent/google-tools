import type { CallFact } from "../tool"
import { YOUTUBE_WORDS } from "./words"

/** What a prompt names a position as when Google gave none. */
const UNKNOWN_POSITION = "unknown"

/** A position as a prompt shows it: the number the arguments use, which counts from 0. */
export function positionText(position: number | null): string {
  return position === null ? UNKNOWN_POSITION : String(position)
}

/** How many entries the playlist holds now; none when Google gave no count. */
export function entriesFacts(itemCount: number | null): CallFact[] {
  if (itemCount === null) return []
  return [
    {
      label: YOUTUBE_WORDS.entries,
      value: {
        text: itemCount === 1 ? YOUTUBE_WORDS.entriesOne : YOUTUBE_WORDS.entriesMany,
        values: { count: itemCount },
      },
    },
  ]
}
