import { checkedLanguage, refusal } from "./checks"
import type { Localization } from "./video-state"

/** The most languages one edit sets localizations for. */
export const MAX_LOCALIZATIONS = 50

/** The localizations an edit sets and removes, as its arguments give them. */
export type LocalizationEdit = {
  set_localizations?: Record<string, Localization>
  remove_localizations?: string[]
}

/** The checks of the title and the description of a localization, which differ by what the localizations belong to; each names its value in the refusal by `subject`. */
export type LocalizationChecks = {
  title: (title: string, subject: string) => unknown
  description: (description: string, subject: string) => unknown
}

/**
 * Refuses a call that sets more than `MAX_LOCALIZATIONS` languages, a language
 * that is no language tag, one set with neither a title nor a description, a
 * title or a description that `checks` refuse, and a language both set and
 * removed.
 */
export function checkLocalizations(args: LocalizationEdit, checks: LocalizationChecks): void {
  const sets = Object.entries(args.set_localizations ?? {})
  if (sets.length > MAX_LOCALIZATIONS) {
    throw refusal(`\`set_localizations\` names ${sets.length} languages, at most ${MAX_LOCALIZATIONS} are allowed`)
  }
  for (const [language, set] of sets) {
    checkedLanguage(language, "A `set_localizations` language")
    if (set.title === undefined && set.description === undefined) {
      throw refusal(`The localization \`${language}\` sets neither a title nor a description`)
    }
    if (set.title !== undefined) checks.title(set.title, `The title of the \`${language}\` localization`)
    if (set.description !== undefined) {
      checks.description(set.description, `The description of the \`${language}\` localization`)
    }
  }
  for (const language of args.remove_localizations ?? []) {
    checkedLanguage(language, "A `remove_localizations` language")
    if (args.set_localizations !== undefined && Object.hasOwn(args.set_localizations, language)) {
      throw refusal(`The language \`${language}\` is both set and removed`)
    }
  }
}

/**
 * The localizations after the edit: `current` without the languages removed,
 * each language set merged over its entry. A language that is new needs a
 * title, and the `owner` (`video` or `playlist`) needs a default language once
 * it has any localization, which `defaultLanguage` is.
 */
export function mergedLocalizations(
  current: Record<string, Localization>,
  args: LocalizationEdit,
  defaultLanguage: string | undefined,
  owner: string,
): Record<string, Localization> {
  if (args.set_localizations === undefined && args.remove_localizations === undefined) return current
  const localizations = { ...current }
  for (const language of args.remove_localizations ?? []) delete localizations[language]
  for (const [language, set] of Object.entries(args.set_localizations ?? {})) {
    const existing = current[language]
    if (existing === undefined && set.title === undefined) {
      throw refusal(`The localization \`${language}\` is new, so it needs a \`title\``)
    }
    localizations[language] = { ...existing, ...set }
  }
  if (Object.keys(localizations).length > 0 && defaultLanguage === undefined) {
    throw refusal(
      `Localizations need the ${owner}'s default language, and the ${owner} has none; give \`default_language\` in the same call`,
    )
  }
  return localizations
}
