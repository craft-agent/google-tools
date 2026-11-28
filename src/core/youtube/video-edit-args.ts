import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_DESCRIPTION_BYTES, MAX_TAG_CHARACTERS, MAX_TITLE_CHARACTERS } from "./checks"
import { videoArg } from "./write-args"

/** The most languages one edit sets localizations for. */
export const MAX_LOCALIZATIONS = 50

/** The licenses a video can have. */
export const VIDEO_LICENSES = ["youtube", "creativeCommon"] as const

const languageHelp = "a language tag such as `en`, `ja` or `pt-BR`"

const localizationInput = z.strictObject({
  title: z
    .string()
    .optional()
    .describe(`The title in this language (1 to ${MAX_TITLE_CHARACTERS} characters); needed for a new language.`),
  description: z.string().optional().describe("The description in this language."),
})

export const youtubeVideoEditInput = z.strictObject({
  account: accountArg,
  video: videoArg,
  title: z
    .string()
    .optional()
    .describe(`The new title: 1 to ${MAX_TITLE_CHARACTERS} characters, without \`<\` or \`>\`.`),
  description: z
    .string()
    .optional()
    .describe(
      `The new description, replacing the old one (\`""\` clears it): at most ${MAX_DESCRIPTION_BYTES} bytes in UTF-8, without \`<\` or \`>\`.`,
    ),
  add_tags: z
    .array(z.string())
    .optional()
    .describe(
      `Tags to add to the ones the video has. A tag holds no \`<\`, \`>\` or comma; all the tags come to at most ${MAX_TAG_CHARACTERS} characters as Google counts them (a comma between two, 2 more for a tag with a space).`,
    ),
  remove_tags: z
    .array(z.string())
    .optional()
    .describe("Tags to remove, each matched exactly. A tag the video does not have is ignored."),
  category: z.string().optional().describe("The category's id, up to three digits (such as `22` for People & Blogs)."),
  default_language: z.string().optional().describe(`The language of the title and description, as ${languageHelp}.`),
  default_audio_language: z.string().optional().describe(`The language the video is spoken in, as ${languageHelp}.`),
  license: z.enum(VIDEO_LICENSES).optional().describe("`youtube` (the standard license) or `creativeCommon`."),
  embeddable: z.boolean().optional().describe("Whether other sites may embed the video."),
  public_stats: z.boolean().optional().describe("Whether the watch page shows the video's statistics."),
  made_for_kids: z.boolean().optional().describe("Whether the video is made for kids, which only the owner declares."),
  synthetic_media: z
    .boolean()
    .optional()
    .describe("Whether the video holds realistic altered or synthetic content, which YouTube asks to be disclosed."),
  set_localizations: z
    .record(z.string(), localizationInput)
    .optional()
    .describe(
      `Titles and descriptions in other languages, by language tag, at most ${MAX_LOCALIZATIONS}: each merges over the language's entry, and a language the video lacks needs a \`title\`. The video needs a default language, the call's \`default_language\` or its own.`,
    ),
  remove_localizations: z.array(z.string()).optional().describe("Languages whose localization is removed."),
})

/** A value of a changed field, as a result returns it: text, a flag, a list, a localization, or null for none. */
const changeValue = z.union([z.string(), z.boolean(), z.array(z.string()), z.record(z.string(), z.string()), z.null()])

export type ChangeValue = z.output<typeof changeValue>

export const youtubeVideoEditOutput = z.object({
  video_id: z.string(),
  url: z.string(),
  privacy: z.string().nullable().describe("The video's privacy now: `private`, `unlisted` or `public`."),
  changed: z
    .array(
      z.object({
        field: z.string().describe("The argument that names it; a localization is `localization <language>`."),
        before: changeValue.describe("The value the video had, null for none."),
        after: changeValue.describe("The value Google reports now, null for none."),
      }),
    )
    .describe("The fields the edit changed, each as it was and as it is."),
})

export type YoutubeVideoEditArgs = z.output<typeof youtubeVideoEditInput>
export type YoutubeVideoEditResult = z.input<typeof youtubeVideoEditOutput>
