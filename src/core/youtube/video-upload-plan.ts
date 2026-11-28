import { extname, isAbsolute } from "node:path"
import { encryptDirsOf, isUnderEncryptDirs } from "../files/encrypt-dirs"
import { hashUpload, openUpload, uploadDirsOf, type OpenUpload, type Upload } from "../files/upload"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import {
  checkedCategory,
  checkedDescription,
  checkedLanguage,
  checkedTags,
  checkedTitle,
  encryptedFileRefusal,
  refusal,
} from "./checks"
import { youtubeError } from "./errors"
import { ownChannel } from "./own-calls"
import { YOUTUBE_ROUTES } from "./routes"
import {
  DEFAULT_CATEGORY,
  DEFAULT_UPLOAD_GIB,
  UPLOAD_MAX_GIB_OPTION,
  type YoutubeVideoUploadArgs,
} from "./video-upload-args"
import { youtubeWriteSession } from "./write-session"

/** The privacy every upload names: Google makes a video sent without one public. */
export const UPLOAD_PRIVACY = "private"

const BYTES_PER_GIB = 1024 ** 3

/** The media type of each extension a video may have; any other is refused. */
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
}

/** The file an upload sends, as it was read for the plan. */
export type VideoUploadFile = Pick<Upload, "path" | "size" | "sha256">

/** A video file opened under the upload rules: what `openUpload` gives, and the media type its extension names. */
export type OpenVideo = OpenUpload & { mimeType: string }

/** The body that opens the session: the video's `snippet` and `status`, as `videos.insert` takes them. */
export type VideoInsertBody = {
  snippet: Record<string, unknown>
  status: Record<string, unknown>
}

/** Everything an upload is made of, read and checked: describing, targeting, measuring and sending it all plan with this. */
export type VideoUploadPlan = {
  session: GoogleSession
  /** The id of the label's channel, which the video is made in. */
  channel: string
  file: VideoUploadFile
  mimeType: string
  title: string
  description: string | undefined
  madeForKids: boolean
  body: VideoInsertBody
}

/** How many GiB a video may hold: the `youtube_upload_max_gib` setting, else 2. */
function uploadGib(ctx: ToolContext): number {
  const given = ctx.options?.[UPLOAD_MAX_GIB_OPTION]
  return typeof given === "number" ? given : DEFAULT_UPLOAD_GIB
}

/**
 * Opens the video at the absolute `path` under the upload rules, and refuses,
 * closing the handle, a file over the size limit (`invalid_argument`, naming
 * the setting and the limit), one under `encrypt_dirs` (`forbidden`: YouTube
 * would hold only ciphertext) and one whose extension is no video's
 * (`invalid_argument`). The caller closes the handle.
 */
export async function openVideo(path: string, ctx: ToolContext): Promise<OpenVideo> {
  const gib = uploadGib(ctx)
  // The size is judged here, not by `openUpload`, so the refusal can name the setting.
  const opened = await openUpload(path, {
    uploadDirs: uploadDirsOf(ctx),
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    maxBytes: Number.MAX_SAFE_INTEGER,
  })
  try {
    if (opened.size > gib * BYTES_PER_GIB) {
      throw refusal(
        `"${opened.path}" is ${opened.size} bytes; a video may hold at most ${gib} GiB (the ${UPLOAD_MAX_GIB_OPTION} setting, 1 to 256)`,
      )
    }
    if (await isUnderEncryptDirs(opened.path, encryptDirsOf(ctx))) throw encryptedFileRefusal(opened.path)
    const extension = extname(opened.path).toLowerCase()
    const mimeType = Object.hasOwn(VIDEO_TYPES, extension) ? VIDEO_TYPES[extension] : undefined
    if (mimeType === undefined) {
      throw refusal(
        `"${opened.path}" is not a video file; its extension must be one of ${Object.keys(VIDEO_TYPES).join(", ")}`,
      )
    }
    return { ...opened, mimeType }
  } catch (error) {
    await opened.handle.close()
    throw error
  }
}

/** The body of the session's start, each limit of Google checked: `privacyStatus` is always `private`, and the made-for-kids declaration is the call's. */
function bodyOf(args: YoutubeVideoUploadArgs): VideoInsertBody {
  const tags = args.tags === undefined ? [] : checkedTags(args.tags)
  return {
    snippet: {
      title: checkedTitle(args.title),
      ...(args.description !== undefined && { description: checkedDescription(args.description) }),
      ...(tags.length > 0 && { tags }),
      categoryId: checkedCategory(args.category ?? DEFAULT_CATEGORY),
      ...(args.default_language !== undefined && {
        defaultLanguage: checkedLanguage(args.default_language, "`default_language`"),
      }),
      ...(args.default_audio_language !== undefined && {
        defaultAudioLanguage: checkedLanguage(args.default_audio_language, "`default_audio_language`"),
      }),
    },
    status: {
      privacyStatus: UPLOAD_PRIVACY,
      selfDeclaredMadeForKids: args.made_for_kids,
      ...(args.license !== undefined && { license: args.license }),
      ...(args.embeddable !== undefined && { embeddable: args.embeddable }),
      ...(args.public_stats !== undefined && { publicStatsViewable: args.public_stats }),
      ...(args.synthetic_media !== undefined && { containsSyntheticMedia: args.synthetic_media }),
    },
  }
}

/** The file at `path`, opened under the video rules, read through for its SHA-256 and closed. */
async function readVideo(path: string, ctx: ToolContext): Promise<{ file: VideoUploadFile; mimeType: string }> {
  const { handle, mimeType, ...opened } = await openVideo(path, ctx)
  try {
    return { file: { path: opened.path, size: opened.size, sha256: await hashUpload(handle, opened.size) }, mimeType }
  } finally {
    await handle.close()
  }
}

/**
 * Checks the arguments (an absolute path, every limit of Google) and the
 * label's scopes before anything is read, then reads the video under the
 * upload rules (see `openVideo`) and hashes it, then reads the label's
 * channel, which the video is made in; an account with no channel is
 * `not_found`. Any failure here fails the call before anything is created.
 */
export async function planVideoUpload(args: YoutubeVideoUploadArgs, ctx: ToolContext): Promise<VideoUploadPlan> {
  if (!isAbsolute(args.path)) throw refusal(`\`path\` "${args.path}" must be an absolute path`)
  const body = bodyOf(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.videosInsert)
  const { file, mimeType } = await readVideo(args.path, ctx)
  let channel: string
  try {
    channel = (await ownChannel(session, "id")).id
  } catch (error) {
    throw youtubeError(error)
  }
  return {
    session,
    channel,
    file,
    mimeType,
    title: args.title,
    description: args.description,
    madeForKids: args.made_for_kids,
    body,
  }
}
