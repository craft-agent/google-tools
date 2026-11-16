import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { ROOT_FOLDER } from "./ids"
import { MAX_MIME_TYPE_LENGTH } from "./schemas"

/** The most GiB, and so bytes, of a file that `upload` sends. */
export const MAX_UPLOAD_GIB = 2
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_GIB * 1024 * 1024 * 1024

/** The most characters of the name a file is given in Drive. */
export const MAX_UPLOAD_NAME_LENGTH = 500

/** Matches a control character, which no file name holds. */
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u

/** A media type as `type/subtype`, with none of the parameters a header could carry more through. */
const MIME_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

/** Whether `name` is 1 to `MAX_UPLOAD_NAME_LENGTH` characters long and holds no control character. */
export function isPlainName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_UPLOAD_NAME_LENGTH && !CONTROL_CHARACTER_PATTERN.test(name)
}

export const driveUploadInput = z.strictObject({
  account: accountArg,
  path: z
    .string()
    .min(1)
    .describe(
      "The file to upload: an absolute path inside the upload directories a person set up (none by default). A link, a hard-linked file or a file outside them is refused.",
    ),
  folder: z
    .string()
    .optional()
    .describe(
      `The folder to put the file in: its id, or \`${ROOT_FOLDER}\` for the top of My Drive (default). It must be the account's own and shared with no one, and not in a shared drive.`,
    ),
  name: z
    .string()
    .min(1)
    .max(MAX_UPLOAD_NAME_LENGTH)
    .refine((name) => isPlainName(name), "A name holds no control character.")
    .optional()
    .describe(
      `The name the file gets in Drive, 1 to ${MAX_UPLOAD_NAME_LENGTH} characters with no control character; left out, the file's own name.`,
    ),
  mime_type: z
    .string()
    .min(1)
    .max(MAX_MIME_TYPE_LENGTH)
    .regex(MIME_TYPE_PATTERN, "A media type is `type/subtype`, such as `application/pdf`.")
    .optional()
    .describe(
      "The file's media type (`application/pdf`); left out, taken from the file's extension, else `application/octet-stream`.",
    ),
})

export const driveUploadOutput = z.object({
  file_id: z.string().describe("The id of the new file; empty if Google did not report it."),
  name: z.string().describe("The name the file has in Drive."),
  mime_type: z.string().describe("Its media type."),
  size: z.number().int().describe("Its size in bytes."),
  folder_id: z.string().describe("The id of the folder it is in; for My Drive, the id of its top folder."),
  web_view_link: z.string().nullable().describe("A link that opens it for a person who may open it; null if none."),
})

export type DriveUploadArgs = z.output<typeof driveUploadInput>
export type DriveUploadResult = z.output<typeof driveUploadOutput>
