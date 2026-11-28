import { canonicalJson } from "../pin"
import { mergedLocalizations } from "./localizations"
import type { YoutubePlaylistEditArgs } from "./playlist-args"
import type { PlaylistSnippet, PlaylistState } from "./playlist-state"
import type { ChangeValue } from "./video-edit-args"
import { localizationValue, type FieldChange } from "./video-edit-merge"

/** The parts of a playlist an edit sends, in the order `part` lists them. */
export const PLAYLIST_EDIT_PARTS = ["snippet", "localizations"] as const

export type PlaylistEditPart = (typeof PLAYLIST_EDIT_PARTS)[number]

/** A field a playlist edit changed, as the arguments name it, with the part of the playlist it lives in. */
export type PlaylistFieldChange = FieldChange & { part: PlaylistEditPart }

/** A field one argument sets: how the result reads it. */
type Field = {
  name: string
  given: (args: YoutubePlaylistEditArgs) => boolean
  read: (state: PlaylistState) => ChangeValue
}

const FIELDS: readonly Field[] = [
  { name: "title", given: (a) => a.title !== undefined, read: (s) => s.snippet.title },
  { name: "description", given: (a) => a.description !== undefined, read: (s) => s.snippet.description },
  {
    name: "default_language",
    given: (a) => a.default_language !== undefined,
    read: (s) => s.snippet.defaultLanguage ?? null,
  },
]

/** The snippet after the edit: the whole writable snippet as read, with the changes. */
function mergedSnippet(read: PlaylistSnippet, args: YoutubePlaylistEditArgs): PlaylistSnippet {
  const snippet = { ...read }
  if (args.title !== undefined) snippet.title = args.title
  if (args.description !== undefined) snippet.description = args.description
  if (args.default_language !== undefined) snippet.defaultLanguage = args.default_language
  return snippet
}

/** The playlist as it is once `args` are applied to `state`; `invalid_argument` for a change Google's rules refuse. */
export function mergedPlaylist(state: PlaylistState, args: YoutubePlaylistEditArgs): PlaylistState {
  const snippet = mergedSnippet(state.snippet, args)
  return {
    ...state,
    snippet,
    localizations: mergedLocalizations(state.localizations, args, snippet.defaultLanguage, "playlist"),
  }
}

/** The fields `args` set whose value differs between `before` and `after`, in the order the arguments are listed. */
export function changedFields(
  before: PlaylistState,
  after: PlaylistState,
  args: YoutubePlaylistEditArgs,
): PlaylistFieldChange[] {
  const named = FIELDS.filter((field) => field.given(args)).map((field): PlaylistFieldChange => ({
    part: "snippet",
    field: field.name,
    before: field.read(before),
    after: field.read(after),
  }))
  const languages = new Set([...Object.keys(args.set_localizations ?? {}), ...(args.remove_localizations ?? [])])
  const localized = [...languages].map((language): PlaylistFieldChange => ({
    part: "localizations",
    field: `localization ${language}`,
    before: localizationValue(before.localizations, language),
    after: localizationValue(after.localizations, language),
  }))
  return [...named, ...localized].filter((change) => canonicalJson(change.before) !== canonicalJson(change.after))
}

/** The fields of `changes` as the result reports them, `after` read from `state`, which is the playlist as Google reports it. */
export function reportedChanges(changes: readonly PlaylistFieldChange[], state: PlaylistState) {
  return changes.map(({ field, before }) => ({ field, before, after: valueOf(field, state) }))
}

/** The value of the field named `field` (an argument's name, or `localization <language>`) in `state`. */
function valueOf(field: string, state: PlaylistState): ChangeValue {
  const named = FIELDS.find((candidate) => candidate.name === field)
  return named === undefined
    ? localizationValue(state.localizations, field.slice("localization ".length))
    : named.read(state)
}
