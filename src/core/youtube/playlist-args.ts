import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_PLAYLIST_DESCRIPTION_CHARACTERS, MAX_PLAYLIST_TITLE_CHARACTERS } from "./checks"
import { MAX_LOCALIZATIONS } from "./localizations"
import { changeValue, languageHelp } from "./video-edit-args"
import { playlistArg } from "./write-args"

const titleHelp = `1 to ${MAX_PLAYLIST_TITLE_CHARACTERS} characters, without \`<\` or \`>\``
const descriptionHelp = `at most ${MAX_PLAYLIST_DESCRIPTION_CHARACTERS} characters, without \`<\` or \`>\``

const newLocalizationInput = z.strictObject({
  title: z.string().describe(`The title in this language (${titleHelp}).`),
  description: z.string().optional().describe("The description in this language."),
})

const localizationInput = z.strictObject({
  title: z.string().optional().describe(`The title in this language (${titleHelp}); needed for a new language.`),
  description: z.string().optional().describe("The description in this language."),
})

export const youtubePlaylistCreateInput = z.strictObject({
  account: accountArg,
  title: z.string().describe(`The playlist's title: ${titleHelp}.`),
  description: z.string().optional().describe(`The playlist's description: ${descriptionHelp}.`),
  default_language: z.string().optional().describe(`The language of the title and description, as ${languageHelp}.`),
  localizations: z
    .record(z.string(), newLocalizationInput)
    .optional()
    .describe(
      `The title and description in other languages, by language tag, at most ${MAX_LOCALIZATIONS}. They need \`default_language\`.`,
    ),
})

export const youtubePlaylistCreateOutput = z.object({
  playlist_id: z.string(),
  title: z.string(),
  privacy: z.string().nullable().describe("The playlist's privacy as Google reports it: `private` for a new playlist."),
  url: z.string(),
})

export const youtubePlaylistEditInput = z.strictObject({
  account: accountArg,
  playlist: playlistArg,
  title: z.string().optional().describe(`The new title: ${titleHelp}.`),
  description: z
    .string()
    .optional()
    .describe(`The new description, replacing the old one (\`""\` clears it): ${descriptionHelp}.`),
  default_language: z.string().optional().describe(`The language of the title and description, as ${languageHelp}.`),
  set_localizations: z
    .record(z.string(), localizationInput)
    .optional()
    .describe(
      `Titles and descriptions in other languages, by language tag, at most ${MAX_LOCALIZATIONS}: each merges over the language's entry, and a language the playlist lacks needs a \`title\`. The playlist needs a default language, the call's \`default_language\` or its own.`,
    ),
  remove_localizations: z.array(z.string()).optional().describe("Languages whose localization is removed."),
})

export const youtubePlaylistEditOutput = z.object({
  playlist_id: z.string(),
  url: z.string(),
  privacy: z.string().describe("The playlist's privacy now: `private`, `unlisted` or `public`."),
  changed: z
    .array(
      z.object({
        field: z.string().describe("The argument that names it; a localization is `localization <language>`."),
        before: changeValue.describe("The value the playlist had, null for none."),
        after: changeValue.describe("The value Google reports now, null for none."),
      }),
    )
    .describe("The fields the edit changed, each as it was and as it is."),
})

export type YoutubePlaylistCreateArgs = z.output<typeof youtubePlaylistCreateInput>
export type YoutubePlaylistCreateResult = z.input<typeof youtubePlaylistCreateOutput>
export type YoutubePlaylistEditArgs = z.output<typeof youtubePlaylistEditInput>
export type YoutubePlaylistEditResult = z.input<typeof youtubePlaylistEditOutput>
