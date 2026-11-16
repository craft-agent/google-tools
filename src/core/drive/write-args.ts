import { z } from "zod"
import { ROOT_FOLDER } from "./ids"
import { MAX_UPLOAD_NAME_LENGTH, isPlainName } from "./upload-args"

/** The `folder` argument of a tool that puts something in a folder: the same folder rules as the upload's. */
export function folderArg(purpose: string) {
  return z
    .string()
    .optional()
    .describe(
      `The folder ${purpose}: its id, or \`${ROOT_FOLDER}\` for the top of My Drive (default). It must be the account's own and shared with no one, not in the trash and not in a shared drive.`,
    )
}

/** The id of a file or folder, as `google_drive_read` gives it. */
export function fileIdArg(what: string) {
  return z.string().min(1).describe(`The id of ${what}, as \`google_drive_read\` gives it.`)
}

/** A name in Drive: 1 to `MAX_UPLOAD_NAME_LENGTH` characters, no control character. */
export function nameArg(description: string) {
  return z
    .string()
    .min(1)
    .max(MAX_UPLOAD_NAME_LENGTH)
    .refine((name) => isPlainName(name), "A name holds no control character.")
    .describe(`${description} 1 to ${MAX_UPLOAD_NAME_LENGTH} characters with no control character.`)
}
