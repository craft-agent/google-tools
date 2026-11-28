import { mergeTranslations, type Translations } from "./core"
import { COMMENTS_TRANSLATIONS, COMMENTS_WORDS } from "./core/comments/words"
import { DRIVE_TRANSLATIONS, DRIVE_WORDS } from "./core/drive/words"
import { FACT_TRANSLATIONS } from "./core/facts"
import { GMAIL_TRANSLATIONS, GMAIL_WORDS } from "./core/gmail/words"
import { RUN_TRANSLATIONS, RUN_WORDS } from "./core/run/words"
import { SHEETS_TRANSLATIONS, SHEETS_WORDS } from "./core/sheets/words"
import { YOUTUBE_TRANSLATIONS, YOUTUBE_WORDS } from "./core/youtube/words"

/** The translations of every tool's words, per language, which the native plugins use in their approval prompts. */
export const ALL_TRANSLATIONS: Translations = mergeTranslations(
  FACT_TRANSLATIONS,
  SHEETS_TRANSLATIONS,
  GMAIL_TRANSLATIONS,
  DRIVE_TRANSLATIONS,
  COMMENTS_TRANSLATIONS,
  RUN_TRANSLATIONS,
  YOUTUBE_TRANSLATIONS,
)

/** The headline templates, fact labels, value templates and text labels the tools' describers use, which `ALL_TRANSLATIONS` must translate. */
export const TOOL_WORDS: readonly string[] = [
  ...Object.values(SHEETS_WORDS),
  ...Object.values(GMAIL_WORDS),
  ...Object.values(DRIVE_WORDS),
  ...Object.values(COMMENTS_WORDS),
  ...Object.values(RUN_WORDS),
  ...Object.values(YOUTUBE_WORDS),
]
