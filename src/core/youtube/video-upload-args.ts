import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_DESCRIPTION_BYTES, MAX_TAG_CHARACTERS, MAX_TITLE_CHARACTERS } from "./checks"
import { VIDEO_LICENSES } from "./video-edit-args"

/** The package setting that raises the size limit of a video upload, in GiB. */
export const UPLOAD_MAX_GIB_OPTION = "youtube_upload_max_gib"

/** The most GiB of a video upload when the setting is not given. */
export const DEFAULT_UPLOAD_GIB = 2

/** The category an upload goes into when none is given: `22`, People & Blogs. */
export const DEFAULT_CATEGORY = "22"

const languageHelp = "a language tag such as `en`, `ja` or `pt-BR`"

export const youtubeVideoUploadInput = z.strictObject({
  account: accountArg,
  path: z
    .string()
    .min(1)
    .describe(
      "The video to upload: an absolute path inside the upload directories a person set up (none by default), a `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv` or `.avi` file. A link, a hard-linked file or a file outside them is refused.",
    ),
  title: z.string().describe(`The video's title: 1 to ${MAX_TITLE_CHARACTERS} characters, without \`<\` or \`>\`.`),
  description: z
    .string()
    .optional()
    .describe(`The description: at most ${MAX_DESCRIPTION_BYTES} bytes in UTF-8, without \`<\` or \`>\`.`),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      `The video's tags, all of them (the video is new). A tag holds no \`<\`, \`>\` or comma; all the tags come to at most ${MAX_TAG_CHARACTERS} characters as Google counts them (a comma between two, 2 more for a tag with a space).`,
    ),
  category: z
    .string()
    .optional()
    .describe(`The category's id, up to three digits; default \`${DEFAULT_CATEGORY}\` (People & Blogs).`),
  default_language: z.string().optional().describe(`The language of the title and description, as ${languageHelp}.`),
  default_audio_language: z.string().optional().describe(`The language the video is spoken in, as ${languageHelp}.`),
  license: z.enum(VIDEO_LICENSES).optional().describe("`youtube` (the standard license, default) or `creativeCommon`."),
  embeddable: z.boolean().optional().describe("Whether other sites may embed the video."),
  public_stats: z.boolean().optional().describe("Whether the watch page shows the video's statistics."),
  made_for_kids: z
    .boolean()
    .describe(
      "Whether the video is made for kids. Required, with no default: YouTube requires the uploader to declare it, so the person's answer is needed, never a guess.",
    ),
  synthetic_media: z
    .boolean()
    .optional()
    .describe("Whether the video holds realistic altered or synthetic content, which YouTube asks to be disclosed."),
})

export const youtubeVideoUploadOutput = z.object({
  video_id: z.string().describe("The id of the new video; empty if Google did not report it."),
  url: z.string().nullable().describe("The video's watch address; null if Google did not report the id."),
  title: z.string().describe("The title the video has."),
  privacy: z
    .string()
    .nullable()
    .describe(
      "The video's privacy as Google reports it, `private` unless an account setting says otherwise; null if none.",
    ),
  upload_status: z
    .string()
    .nullable()
    .describe("Where YouTube's processing of the upload stands, such as `uploaded`; null if Google reported none."),
  made_for_kids: z.boolean().describe("Whether the video is made for kids, as Google reports it, else as declared."),
  note: z
    .string()
    .nullable()
    .describe(
      "A sentence when Google reports a privacy other than `private`, saying to check YouTube Studio; else null.",
    ),
})

export type YoutubeVideoUploadArgs = z.output<typeof youtubeVideoUploadInput>
export type YoutubeVideoUploadResult = z.input<typeof youtubeVideoUploadOutput>
