import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_CHANNEL_DESCRIPTION_CHARACTERS, MAX_KEYWORD_CHARACTERS } from "./checks"
import { changeValue, languageHelp } from "./video-edit-args"

export const youtubeChannelEditInput = z.strictObject({
  account: accountArg,
  description: z
    .string()
    .optional()
    .describe(
      `The channel's new description, replacing the old one (\`""\` clears it): at most ${MAX_CHANNEL_DESCRIPTION_CHARACTERS} characters, without \`<\` or \`>\`.`,
    ),
  add_keywords: z
    .array(z.string())
    .optional()
    .describe(
      `Keywords to add to the ones the channel has. A keyword holds no \`"\`; all the keywords come to at most ${MAX_KEYWORD_CHARACTERS} characters as Google counts them (a space between two, 2 more for a keyword with a space).`,
    ),
  remove_keywords: z
    .array(z.string())
    .optional()
    .describe("Keywords to remove, each matched exactly. A keyword the channel does not have is ignored."),
  country: z.string().optional().describe('The channel\'s country as two letters, such as `JP`; `""` removes it.'),
  default_language: z.string().optional().describe(`The channel's default language, as ${languageHelp}.`),
  trailer: z
    .string()
    .optional()
    .describe(
      'The video shown to people who have not subscribed: the id or address of one of the channel\'s own videos; `""` removes it.',
    ),
})

export const youtubeChannelEditOutput = z.object({
  channel_id: z.string(),
  url: z.string(),
  changed: z
    .array(
      z.object({
        field: z
          .string()
          .describe(
            "The argument that names it (`description`, `keywords`, `country`, `default_language`, `trailer`).",
          ),
        before: changeValue.describe("The value the channel had, null for none."),
        after: changeValue.describe("The value Google reports now, null for none."),
      }),
    )
    .describe("The fields the edit changed, each as it was and as it is."),
  note: z.string().describe("What this tool does not change."),
})

export type YoutubeChannelEditArgs = z.output<typeof youtubeChannelEditInput>
export type YoutubeChannelEditResult = z.input<typeof youtubeChannelEditOutput>
