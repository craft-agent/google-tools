import { isAbsolute } from "node:path"
import type { Upload } from "../files/upload"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { refusal } from "./checks"
import { videoId } from "./ids"
import { readImage, type ImageKind } from "./image-file"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import type { YoutubeThumbnailArgs } from "./thumbnail-args"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The most bytes of a thumbnail, as Google counts them: 50 MB. */
export const MAX_THUMBNAIL_BYTES = 50 * 1000 * 1000

/** A thumbnail planned: the video as it was read and the image to send, as read and hashed. */
export type ThumbnailPlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  state: VideoState
  /** The image: its real path, bytes and SHA-256. */
  file: Upload
  image: ImageKind
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
  const { file, image } = await readImage(args.path, ctx, { maxBytes: MAX_THUMBNAIL_BYTES, subject: "a thumbnail" })
  const { state } = await ownVideo(session, video)
  return { session, video, state, file, image }
}
