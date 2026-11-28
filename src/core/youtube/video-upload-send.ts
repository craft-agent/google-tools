import type { FileHandle } from "node:fs/promises"
import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import { UPLOAD_CHUNK_BYTES, UPLOAD_TIMEOUT_MS, putFile } from "../files/resumable-send"
import type { ResumableSession } from "../google/resumable"
import type { ToolContext } from "../tool"
import { youtubeError } from "./errors"
import { YOUTUBE_ROUTES } from "./routes"
import type { YoutubeVideoUploadResult } from "./video-upload-args"
import { UPLOAD_PRIVACY, openVideo, type VideoUploadPlan } from "./video-upload-plan"
import { videoUrl } from "./views"

/** The parts of the new video the session's start names and the final answer carries. */
const UPLOAD_PARTS = "snippet,status"

/** What a failure after the session started goes on to say: the video may exist whatever the call reports. */
const LOOK_FIRST_SENTENCE =
  "Before uploading again, look at `google_youtube_read` method `my_videos`: the video may have been made."

/** The new video as Google answers with it, each field optional since the video exists whatever the answer lacks. */
const uploadedReply = z.object({
  id: z.string().optional(),
  snippet: z.object({ title: z.string().optional() }).optional(),
  status: z
    .object({
      privacyStatus: z.string().optional(),
      uploadStatus: z.string().optional(),
      madeForKids: z.boolean().optional(),
      selfDeclaredMadeForKids: z.boolean().optional(),
    })
    .optional(),
})

/** The refusal of an upload whose file is no longer what the call read; YouTube makes the video only when the last byte lands, so none was made. */
function changedFile(): ToolError {
  return new ToolError("stale", "The file changed after it was read; no video was made.")
}

/** The note for a privacy Google reports that is not the `private` the upload named. */
function privacyNote(privacy: string): string {
  return `Google reports the video as ${privacy}, not ${UPLOAD_PRIVACY} as sent. Check it in YouTube Studio: an account setting can change the privacy of a new video.`
}

/** The result of an upload from Google's answer to its last chunk, with what the plan knows where the answer lacks a field. */
function resultOf(plan: VideoUploadPlan, reply: unknown): YoutubeVideoUploadResult {
  const parsed = uploadedReply.safeParse(reply)
  const video = parsed.success ? parsed.data : {}
  const id = video.id ?? ""
  const privacy = video.status?.privacyStatus ?? null
  return {
    video_id: id,
    url: id === "" ? null : videoUrl(id),
    title: video.snippet?.title ?? plan.title,
    privacy,
    upload_status: video.status?.uploadStatus ?? null,
    made_for_kids: video.status?.madeForKids ?? video.status?.selfDeclaredMadeForKids ?? plan.madeForKids,
    note: privacy === null || privacy === UPLOAD_PRIVACY ? null : privacyNote(privacy),
  }
}

/** `error`, as YouTube tools report it, going on to say to look at the channel's videos before uploading again. */
function afterStart(error: unknown): unknown {
  const reported = youtubeError(error)
  if (!isToolError(reported)) return reported
  return new ToolError(reported.code, `${reported.message} ${LOOK_FIRST_SENTENCE}`, {
    cause: reported,
    details: reported.details,
  })
}

/**
 * Opens a resumable session with the plan's body, which names the video
 * (private, as `UPLOAD_PRIVACY` says), and streams the file `handle` holds in
 * chunks of `chunkBytes` (see `putFile`). A failure from the start on says to
 * look at `my_videos` before uploading again, but for the plan's own file
 * having changed, which is `stale` with the last byte unsent: no video was made.
 */
async function sendFile(
  plan: VideoUploadPlan,
  handle: FileHandle,
  chunkBytes: number,
): Promise<YoutubeVideoUploadResult> {
  let session: ResumableSession
  try {
    session = await plan.session.client.startResumable(YOUTUBE_ROUTES.videosInsert, YOUTUBE_ROUTES.videosInsertChunk, {
      query: { uploadType: "resumable", part: UPLOAD_PARTS },
      metadata: plan.body,
      contentType: plan.mimeType,
      size: plan.file.size,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  } catch (error) {
    throw youtubeError(error)
  }
  let changed: ToolError | undefined
  try {
    const reply = await putFile(session, handle, plan.file, chunkBytes, () => (changed = changedFile()))
    return resultOf(plan, reply)
  } catch (error) {
    throw error === changed ? error : afterStart(error)
  }
}

/**
 * Uploads the file `path` names, which the plan read: opens it again under the
 * upload rules (a file that is another size or at another real path now is
 * `stale`, with no session opened) and sends it (see `sendFile`). The handle
 * is closed however the call ends.
 */
export async function sendVideoUpload(
  plan: VideoUploadPlan,
  path: string,
  ctx: ToolContext,
  chunkBytes = UPLOAD_CHUNK_BYTES,
): Promise<YoutubeVideoUploadResult> {
  const opened = await openVideo(path, ctx)
  try {
    if (opened.path !== plan.file.path || opened.size !== plan.file.size) throw changedFile()
    return await sendFile(plan, opened.handle, chunkBytes)
  } finally {
    await opened.handle.close()
  }
}
