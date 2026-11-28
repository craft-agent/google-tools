import type { CallDescription, CallText } from "../tool"
import type { ChangeValue } from "./video-edit-args"
import type { FieldChange } from "./video-edit-merge"
import type { VideoEditPlan } from "./video-edit-plan"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

const LOCALIZATION_PREFIX = "localization "

/** A value as a line of the text shows it: a flag as yes or no, a list comma separated, and none as `(none)`. */
function shownValue(value: ChangeValue): string {
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ")
  return typeof value === "string" ? value : "(none)"
}

/** The lines of one change: `title: …`, `made for kids: yes`, and for a localization its title and, when new, its description. */
function linesOf({ field, before, after }: FieldChange): string[] {
  if (!field.startsWith(LOCALIZATION_PREFIX)) return [`${field.replaceAll("_", " ")}: ${shownValue(after)}`]
  if (after === null || typeof after !== "object" || Array.isArray(after)) return [`${field}: (removed)`]
  const previous = before !== null && typeof before === "object" && !Array.isArray(before) ? before : undefined
  const described =
    after.description !== undefined && after.description !== "" && after.description !== previous?.description
  return [`${field}: ${after.title}`, ...(described ? [`${field} description: ${after.description}`] : [])]
}

/** The text of an edit: a line for each new value of `changes`, with the description last. */
export function newValuesText(changes: readonly FieldChange[]): CallText {
  const lines = changes.filter(({ field }) => field !== "description").flatMap(linesOf)
  const description = changes.find(({ field }) => field === "description")
  return {
    label: YOUTUBE_WORDS.newValues,
    body: [...lines, ...(description === undefined ? [] : linesOf(description))].join("\n"),
  }
}

/**
 * What the prompt shows of an edit: the headline with the video's title as
 * Google has it, who can watch it now, the fields that change, and a line for
 * each new value with the description last. The pin holds every writable
 * property the edit read, so a video changed after the prompt is `stale`.
 */
export function describeVideoEdit({ before, changes }: VideoEditPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.videoEdit, values: { title: before.snippet.title } },
    facts: [
      privacyFact(YOUTUBE_WORDS.privacy, before.status),
      { label: YOUTUBE_WORDS.fields, value: changes.map(({ field }) => field).join(", ") },
    ],
    text: newValuesText(changes),
    pins: { video: statePin(before) },
  }
}
