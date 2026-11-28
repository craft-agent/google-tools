import { extname } from "node:path"
import { encryptDirsOf, isUnderEncryptDirs } from "../files/encrypt-dirs"
import { readUpload, uploadDirsOf, type Upload } from "../files/upload"
import type { ToolContext } from "../tool"
import { encryptedFileRefusal, refusal } from "./checks"

/** A kind of image Google takes as a thumbnail or a watermark: its extensions, the first bytes that tell it, its media type and its name. */
type ImageType = {
  extensions: readonly string[]
  signature: readonly number[]
  mimeType: string
  name: string
}

/** The kind of an image a call sends, as the call and its prompt name it. */
export type ImageKind = Pick<ImageType, "mimeType" | "name">

const IMAGE_TYPES: readonly ImageType[] = [
  { extensions: [".jpg", ".jpeg"], signature: [0xff, 0xd8, 0xff], mimeType: "image/jpeg", name: "JPEG" },
  {
    extensions: [".png"],
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    mimeType: "image/png",
    name: "PNG",
  },
]

/** The kind of image `file` is: its extension names one and its first bytes agree, else `invalid_argument`; `subject` (`a thumbnail`) names what the image is for. */
function imageTypeOf({ path, bytes }: Upload, subject: string): ImageType {
  const type = IMAGE_TYPES.find(({ extensions }) => extensions.includes(extname(path).toLowerCase()))
  if (type === undefined) {
    throw refusal(`"${path}" is not a .jpg, .jpeg or .png file; ${subject} is a JPEG or a PNG`)
  }
  if (!type.signature.every((byte, index) => bytes[index] === byte)) {
    throw refusal(`"${path}" is named as a ${type.name} but its content is not one`)
  }
  return type
}

/**
 * Reads the image at `path` under the upload rules (at most `maxBytes`), which
 * a file under `encrypt_dirs` fails as `forbidden`: YouTube would hold only
 * ciphertext, which no one could watch. An image that is not a JPEG or a PNG,
 * by its extension and by its first bytes, is `invalid_argument`; `subject`
 * (`a thumbnail`) names what it is for.
 */
export async function readImage(
  path: string,
  ctx: ToolContext,
  { maxBytes, subject }: { maxBytes: number; subject: string },
): Promise<{ file: Upload; image: ImageKind }> {
  const file = await readUpload(path, {
    uploadDirs: uploadDirsOf(ctx),
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    maxBytes,
  })
  if (await isUnderEncryptDirs(file.path, encryptDirsOf(ctx))) throw encryptedFileRefusal(file.path)
  const { mimeType, name } = imageTypeOf(file, subject)
  return { file, image: { mimeType, name } }
}
