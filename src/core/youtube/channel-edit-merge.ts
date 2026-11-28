import { canonicalJson } from "../pin"
import type { YoutubeChannelEditArgs } from "./channel-edit-args"
import { keywordsOf, keywordsText, mergedKeywords } from "./channel-keywords"
import type { ChannelState } from "./channel-state"
import { checkedCountry, checkedKeywordTotal } from "./checks"
import type { BrandingSettings } from "./my-channel-view"
import type { ChangeValue } from "./video-edit-args"
import type { FieldChange } from "./video-edit-merge"

type BrandingChannel = NonNullable<BrandingSettings["channel"]>

/** A field a channel edit changed, as the arguments name it. */
export type ChannelFieldChange = Omit<FieldChange, "part">

/** A field of the branding settings one argument (or two) sets: how the result reads it. */
type Field = {
  name: string
  given: (args: YoutubeChannelEditArgs) => boolean
  read: (state: ChannelState) => ChangeValue
}

const FIELDS: readonly Field[] = [
  {
    name: "description",
    given: (a) => a.description !== undefined,
    read: (s) => s.branding.channel?.description ?? "",
  },
  {
    name: "keywords",
    given: (a) => a.add_keywords !== undefined || a.remove_keywords !== undefined,
    read: (s) => keywordsOf(s.branding.channel?.keywords),
  },
  { name: "country", given: (a) => a.country !== undefined, read: (s) => s.branding.channel?.country ?? null },
  {
    name: "default_language",
    given: (a) => a.default_language !== undefined,
    read: (s) => s.branding.channel?.defaultLanguage ?? null,
  },
  {
    name: "trailer",
    given: (a) => a.trailer !== undefined,
    read: (s) => s.branding.channel?.unsubscribedTrailer ?? null,
  },
]

/** Sets the keywords the edit leaves on `channel`, written as Google stores them (none leaves the property out); a list the edit leaves as it was is not rewritten. */
function withKeywords(channel: BrandingChannel, args: YoutubeChannelEditArgs): void {
  const current = keywordsOf(channel.keywords)
  const merged = mergedKeywords(current, args.add_keywords ?? [], args.remove_keywords ?? [])
  if (canonicalJson(merged) === canonicalJson(current)) return
  checkedKeywordTotal(merged)
  if (merged.length === 0) delete channel.keywords
  else channel.keywords = keywordsText(merged)
}

/**
 * The branding settings after the edit: the whole object as read, unknown
 * keys included, with only the `channel` fields the edit sets changed. The
 * title stays as read, and a country or a trailer set to `""` is left out.
 * `trailer` is the id of the video that becomes the trailer, `""` for none.
 */
function mergedBranding(
  read: BrandingSettings,
  args: YoutubeChannelEditArgs,
  trailer: string | undefined,
): BrandingSettings {
  if (!FIELDS.some((field) => field.given(args))) return read
  const channel = { ...read.channel }
  if (args.description !== undefined) channel.description = args.description
  if (args.add_keywords !== undefined || args.remove_keywords !== undefined) withKeywords(channel, args)
  if (args.country !== undefined) {
    const country = checkedCountry(args.country)
    if (country === "") delete channel.country
    else channel.country = country
  }
  if (args.default_language !== undefined) channel.defaultLanguage = args.default_language
  if (trailer !== undefined) {
    if (trailer === "") delete channel.unsubscribedTrailer
    else channel.unsubscribedTrailer = trailer
  }
  return { ...read, channel }
}

/**
 * The channel as it is once `args` are applied to `state`; `invalid_argument`
 * for a change Google's rules refuse. `trailer` is the id of the video `args`
 * make the trailer, `""` when they remove it.
 */
export function mergedChannel(
  state: ChannelState,
  args: YoutubeChannelEditArgs,
  trailer: string | undefined,
): ChannelState {
  return { ...state, branding: mergedBranding(state.branding, args, trailer) }
}

/** The fields `args` set whose value differs between `before` and `after`, in the order the arguments are listed. */
export function changedFields(
  before: ChannelState,
  after: ChannelState,
  args: YoutubeChannelEditArgs,
): ChannelFieldChange[] {
  return FIELDS.filter((field) => field.given(args))
    .map((field): ChannelFieldChange => ({
      field: field.name,
      before: field.read(before),
      after: field.read(after),
    }))
    .filter((change) => canonicalJson(change.before) !== canonicalJson(change.after))
}

/** The fields of `changes` as the result reports them, `after` read from `state`, which is the channel as Google reports it. */
export function reportedChanges(changes: readonly ChannelFieldChange[], state: ChannelState) {
  return changes.map(({ field, before }) => ({
    field,
    before,
    after: FIELDS.find((candidate) => candidate.name === field)!.read(state),
  }))
}
