import { extname, isAbsolute } from "node:path"
import { encryptDirsOf, isUnderEncryptDirs } from "../files/encrypt-dirs"
import { readUpload, uploadDirsOf, type Upload } from "../files/upload"
import type { ToolContext } from "../tool"
import { CAPTION_EXTENSIONS, MAX_CAPTION_BYTES } from "./caption-args"
import { encryptedFileRefusal, refusal } from "./checks"

/** The media type a caption file is sent as. */
export const CAPTION_MEDIA_TYPE = "application/octet-stream"

/** A caption file as it was read: the upload, and the text it decodes to as UTF-8, which the prompt shows. */
export type CaptionFile = Upload & { text: string }

/**
 * The text of `bytes` as UTF-8. A file that is not valid UTF-8 is still sent
 * as it is; the text then shows what decodes, bytes that do not as `U+FFFD`.
 */
function textOf(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

/**
 * Reads the caption file at the absolute `path` under the upload rules, and
 * refuses a path that is not absolute, a file over 100 MB, one under
 * `encrypt_dirs` (`forbidden`: YouTube would hold only ciphertext) and one
 * whose extension, in any case, is not a caption format's (`invalid_argument`).
 */
export async function readCaptionFile(path: string, ctx: ToolContext): Promise<CaptionFile> {
  if (!isAbsolute(path)) throw refusal(`\`path\` "${path}" must be an absolute path`)
  const file = await readUpload(path, {
    uploadDirs: uploadDirsOf(ctx),
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    maxBytes: MAX_CAPTION_BYTES,
  })
  if (await isUnderEncryptDirs(file.path, encryptDirsOf(ctx))) throw encryptedFileRefusal(file.path)
  const extension = extname(file.path).toLowerCase()
  if (!(CAPTION_EXTENSIONS as readonly string[]).includes(extension)) {
    throw refusal(`"${file.path}" is not a caption file; its extension must be one of ${CAPTION_EXTENSIONS.join(", ")}`)
  }
  return { ...file, text: textOf(file.bytes) }
}
