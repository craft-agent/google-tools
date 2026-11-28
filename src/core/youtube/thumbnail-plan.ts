import { extname, isAbsolute } from "node:path"
import { ToolError } from "../errors"
import { encryptDirsOf, isUnderEncryptDirs } from "../files/encrypt-dirs"
import { readUpload, uploadDirsOf, type Upload } from "../files/upload"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { refusal } from "./checks"
import { videoId } from "./ids"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import type { YoutubeThumbnailArgs } from "./thumbnail-args"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The most bytes of a thumbnail, as Google counts them: 50 MB. */
export const MAX_THUMBNAIL_BYTES = 50 * 1000 * 1000

/** A kind of image Google takes as a thumbnail: its extensions, the first bytes that tell it, its media type and its name. */
type ImageType = {
  extensions: readonly string[]
  signature: readonly number[]
  mimeType: string
  name: string
}

const IMAGE_TYPES: readonly ImageType[] = [
  { extensions: [".jpg", ".jpeg"], signature: [0xff, 0xd8, 0xff], mimeType: "image/jpeg", name: "JPEG" },
  {
    extensions: [".png"],
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    mimeType: "image/png",
    name: "PNG",
  },
]

/** A thumbnail planned: the video as it was read and the image to send, as read and hashed. */
export type ThumbnailPlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  state: VideoState
  /** The image: its real path, bytes and SHA-256. */
  file: Upload
  image: Pick<ImageType, "mimeType" | "name">
}

/** The kind of image `file` is: its extension names one and its first bytes agree, else `invalid_argument`. */
function imageTypeOf({ path, bytes }: Upload): ImageType {
  const type = IMAGE_TYPES.find(({ extensions }) => extensions.includes(extname(path).toLowerCase()))
  if (type === undefined) {
    throw refusal(`"${path}" is not a .jpg, .jpeg or .png file; a thumbnail is a JPEG or a PNG`)
  }
  if (!type.signature.every((byte, index) => bytes[index] === byte)) {
    throw refusal(`"${path}" is named as a ${type.name} but its content is not one`)
  }
  return type
}

/**
 * Checks the arguments (the video's id, an absolute path) and the label's
 * scopes before anything is read, then reads the image under the upload rules
 * (a file under `encrypt_dirs` is `forbidden`: YouTube would hold only
 * ciphertext, which no one could watch; an image that is not a JPEG or a PNG,
 * by extension and by its first bytes, is `invalid_argument`), then reads the
 * label's channel and the video, which must be the channel's own.
 */
export async function planThumbnail(args: YoutubeThumbnailArgs, ctx: ToolContext): Promise<ThumbnailPlan> {
  const video = videoId(args.video)
  if (!isAbsolute(args.path)) throw refusal(`\`path\` "${args.path}" must be an absolute path`)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.thumbnailsSet)
  const file = await readUpload(args.path, {
    uploadDirs: uploadDirsOf(ctx),
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    maxBytes: MAX_THUMBNAIL_BYTES,
  })
  if (await isUnderEncryptDirs(file.path, encryptDirsOf(ctx))) {
    throw new ToolError(
      "forbidden",
      `"${file.path}" is under an encrypt_dirs directory; YouTube would hold only ciphertext, which no one could watch. Nothing was sent.`,
    )
  }
  const { mimeType, name } = imageTypeOf(file)
  const { state } = await ownVideo(session, video)
  return { session, video, state, file, image: { mimeType, name } }
}
