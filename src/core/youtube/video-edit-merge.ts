import { canonicalJson } from "../pin"
import { checkedTagTotal, refusal } from "./checks"
import type { ChangeValue, YoutubeVideoEditArgs } from "./video-edit-args"
import type { VideoSnippet, VideoState, VideoStatus } from "./video-state"

/** The parts of a video an edit sends, in the order `part` lists them. */
export const EDIT_PARTS = ["snippet", "status", "localizations"] as const

export type EditPart = (typeof EDIT_PARTS)[number]

/** A field an edit changed, as the arguments name it, with the part of the video it lives in. */
export type FieldChange = { part: EditPart; field: string; before: ChangeValue; after: ChangeValue }

/** A field one argument sets: where it lives in the video and how the result reads it. */
type Field = {
  name: string
  part: "snippet" | "status"
  given: (args: YoutubeVideoEditArgs) => boolean
  read: (state: VideoState) => ChangeValue
}

const FIELDS: readonly Field[] = [
  { name: "title", part: "snippet", given: (a) => a.title !== undefined, read: (s) => s.snippet.title },
  {
    name: "description",
    part: "snippet",
    given: (a) => a.description !== undefined,
    read: (s) => s.snippet.description,
  },
  {
    name: "tags",
    part: "snippet",
    given: (a) => a.add_tags !== undefined || a.remove_tags !== undefined,
    read: (s) => s.snippet.tags,
  },
  {
    name: "category",
    part: "snippet",
    given: (a) => a.category !== undefined,
    read: (s) => s.snippet.categoryId ?? null,
  },
  {
    name: "default_language",
    part: "snippet",
    given: (a) => a.default_language !== undefined,
    read: (s) => s.snippet.defaultLanguage ?? null,
  },
  {
    name: "default_audio_language",
    part: "snippet",
    given: (a) => a.default_audio_language !== undefined,
    read: (s) => s.snippet.defaultAudioLanguage ?? null,
  },
  { name: "license", part: "status", given: (a) => a.license !== undefined, read: (s) => s.status.license ?? null },
  {
    name: "embeddable",
    part: "status",
    given: (a) => a.embeddable !== undefined,
    read: (s) => s.status.embeddable ?? null,
  },
  {
    name: "public_stats",
    part: "status",
    given: (a) => a.public_stats !== undefined,
    read: (s) => s.status.publicStatsViewable ?? null,
  },
  {
    name: "made_for_kids",
    part: "status",
    given: (a) => a.made_for_kids !== undefined,
    read: (s) => s.status.selfDeclaredMadeForKids ?? null,
  },
  {
    name: "synthetic_media",
    part: "status",
    given: (a) => a.synthetic_media !== undefined,
    read: (s) => s.status.containsSyntheticMedia ?? null,
  },
]

/** The tags the video has after the edit: those it has but `remove_tags` names, then the `add_tags` it lacks, in order. */
function mergedTags(tags: readonly string[], args: YoutubeVideoEditArgs): string[] {
  const removed = new Set(args.remove_tags ?? [])
  const kept = tags.filter((tag) => !removed.has(tag))
  const merged = [...kept, ...new Set(args.add_tags ?? [])].filter((tag, index, all) => all.indexOf(tag) === index)
  if (canonicalJson(merged) !== canonicalJson(tags)) checkedTagTotal(merged)
  return merged
}

/** The snippet after the edit: the whole writable snippet as read, with the changes. */
function mergedSnippet(read: VideoSnippet, args: YoutubeVideoEditArgs): VideoSnippet {
  const snippet = { ...read }
  if (args.title !== undefined) snippet.title = args.title
  if (args.description !== undefined) snippet.description = args.description
  if (args.category !== undefined) snippet.categoryId = args.category
  if (args.default_language !== undefined) snippet.defaultLanguage = args.default_language
  if (args.default_audio_language !== undefined) snippet.defaultAudioLanguage = args.default_audio_language
  if (args.add_tags !== undefined || args.remove_tags !== undefined) snippet.tags = mergedTags(read.tags, args)
  return snippet
}

/** The status after the edit: the whole writable status as read, with the changes. */
function mergedStatus(read: VideoStatus, args: YoutubeVideoEditArgs): VideoStatus {
  const status = { ...read }
  if (args.license !== undefined) status.license = args.license
  if (args.embeddable !== undefined) status.embeddable = args.embeddable
  if (args.public_stats !== undefined) status.publicStatsViewable = args.public_stats
  if (args.made_for_kids !== undefined) status.selfDeclaredMadeForKids = args.made_for_kids
  if (args.synthetic_media !== undefined) status.containsSyntheticMedia = args.synthetic_media
  return status
}

/**
 * The localizations after the edit: the video's, without the languages
 * removed, each language set merged over its entry. A language the video lacks
 * needs a title, and the video needs a default language once it has any
 * localization, which `defaultLanguage` is.
 */
function mergedLocalizations(
  state: VideoState,
  args: YoutubeVideoEditArgs,
  defaultLanguage: string | undefined,
): VideoState["localizations"] {
  if (args.set_localizations === undefined && args.remove_localizations === undefined) return state.localizations
  const localizations = { ...state.localizations }
  for (const language of args.remove_localizations ?? []) delete localizations[language]
  for (const [language, set] of Object.entries(args.set_localizations ?? {})) {
    const existing = state.localizations[language]
    if (existing === undefined && set.title === undefined) {
      throw refusal(`The localization \`${language}\` is new, so it needs a \`title\``)
    }
    localizations[language] = { ...existing, ...set }
  }
  if (Object.keys(localizations).length > 0 && defaultLanguage === undefined) {
    throw refusal(
      "Localizations need the video's default language, and the video has none; give `default_language` in the same call",
    )
  }
  return localizations
}

/** The video as it is once `args` are applied to `state`; `invalid_argument` for a change Google's rules refuse. */
export function mergedState(state: VideoState, args: YoutubeVideoEditArgs): VideoState {
  const snippet = mergedSnippet(state.snippet, args)
  return {
    id: state.id,
    snippet,
    status: mergedStatus(state.status, args),
    localizations: mergedLocalizations(state, args, snippet.defaultLanguage),
  }
}

/** A language's localization as a result reads it, `null` for none. */
function localizationValue(state: VideoState, language: string): ChangeValue {
  const found = state.localizations[language]
  return found === undefined ? null : { title: found.title ?? "", description: found.description ?? "" }
}

/** The fields `args` set whose value differs between `before` and `after`, in the order the arguments are listed. */
export function changedFields(before: VideoState, after: VideoState, args: YoutubeVideoEditArgs): FieldChange[] {
  const named = FIELDS.filter((field) => field.given(args)).map((field): FieldChange => ({
    part: field.part,
    field: field.name,
    before: field.read(before),
    after: field.read(after),
  }))
  const languages = new Set([...Object.keys(args.set_localizations ?? {}), ...(args.remove_localizations ?? [])])
  const localized = [...languages].map((language): FieldChange => ({
    part: "localizations",
    field: `localization ${language}`,
    before: localizationValue(before, language),
    after: localizationValue(after, language),
  }))
  return [...named, ...localized].filter((change) => canonicalJson(change.before) !== canonicalJson(change.after))
}

/** The fields of `changes` as the result reports them, `after` read from `state`, which is the video as Google reports it. */
export function reportedChanges(changes: readonly FieldChange[], state: VideoState) {
  return changes.map(({ field, before }) => ({ field, before, after: valueOf(field, state) }))
}

/** The value of the field named `field` (an argument's name, or `localization <language>`) in `state`. */
function valueOf(field: string, state: VideoState): ChangeValue {
  const named = FIELDS.find((candidate) => candidate.name === field)
  return named === undefined ? localizationValue(state, field.slice("localization ".length)) : named.read(state)
}
