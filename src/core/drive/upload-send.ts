import { createHash } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { ToolError } from "../errors"
import { openUpload, readRange } from "../files/upload"
import type { ResumableSession } from "../google/resumable"
import { requireRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { SUPPORTS_ALL_DRIVES, fileReply, sizeOf } from "./file-view"
import { DRIVE_ROUTES } from "./routes"
import type { DriveUploadResult } from "./upload-args"
import { withCiphertext } from "./upload-encrypt"
import { changedFile, uploadOptions, type UploadFile, type UploadPlan } from "./upload-plan"

/** How many bytes one chunk of an upload holds; a multiple of the 256 KiB Drive takes a chunk in. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

/** How long Google may take to open an upload and to take in each chunk. */
const UPLOAD_TIMEOUT_MS = 120_000

/** How many times one call sends bytes again because Google took in fewer than were sent. */
const MAX_RESENDS = 3

/** The fields of the new file the final answer carries. */
const UPLOADED_FIELDS = "id,name,mimeType,size,parents,webViewLink"

/** The new file as Google answers with it, each field optional since the file exists whatever the answer lacks. */
const uploadedReply = fileReply.partial()

/**
 * Sends the file through `session` in chunks of `chunkBytes`, hashing what goes
 * out, and returns Google's reply to the last one. The last chunk is held
 * until the hash of everything sent with it is the one the plan read; a file
 * that changed (or ended early) is `stale` with the last byte unsent. When
 * Google takes in fewer bytes than were sent, the next chunk starts where it
 * says, at most `MAX_RESENDS` times (`upstream_error`).
 */
async function putFile(
  session: ResumableSession,
  handle: FileHandle,
  file: UploadFile,
  chunkBytes: number,
): Promise<unknown> {
  const hash = createHash("sha256")
  let hashed = 0
  let offset = 0
  let resends = 0
  for (;;) {
    const length = Math.min(chunkBytes, file.size - offset)
    const bytes = await readRange(handle, offset, length)
    if (bytes.length < length) throw changedFile()
    const end = offset + length
    if (end > hashed) {
      hash.update(bytes.subarray(hashed - offset))
      hashed = end
    }
    if (end === file.size && hash.copy().digest("hex") !== file.sha256) throw changedFile()

    const reply = await session.put(bytes, offset, file.size)
    if (reply.done) return reply.file
    if (reply.offset === end && end < file.size) {
      offset = end
      continue
    }
    if (reply.offset >= end) {
      throw new ToolError("upstream_error", "Google took in every byte but did not finish the upload.")
    }
    if (++resends > MAX_RESENDS) {
      throw new ToolError(
        "upstream_error",
        `Google kept taking in fewer bytes than were sent, after ${MAX_RESENDS} resends.`,
      )
    }
    offset = reply.offset
  }
}

/** The result of an upload from Google's answer to its last chunk, with what the plan knows (and `sent`, the bytes of the file that went up) where the answer lacks a field. */
function resultOf(plan: UploadPlan, reply: unknown, sent: UploadFile): DriveUploadResult {
  const parsed = uploadedReply.safeParse(reply)
  const file = parsed.success ? parsed.data : {}
  return {
    file_id: file.id ?? "",
    name: file.name ?? plan.name,
    mime_type: file.mimeType ?? plan.mimeType,
    size: sizeOf(file) ?? sent.size,
    folder_id: file.parents?.[0] ?? plan.destination.id,
    web_view_link: file.webViewLink ?? null,
    ...(plan.encryption.kind === "age"
      ? { encrypted: { with: "age" as const, recipients: plan.encryption.recipients.length } }
      : {}),
  }
}

/**
 * Opens a resumable session naming the plan's name, type and folder, and
 * streams `file`, which `handle` holds, in chunks of `chunkBytes` (see
 * `putFile`). `file` is what goes up: the plan's own file, or its ciphertext.
 */
async function sendFile(
  plan: UploadPlan,
  handle: FileHandle,
  file: UploadFile,
  chunkBytes: number,
): Promise<DriveUploadResult> {
  const session = await plan.client.startResumable(DRIVE_ROUTES.uploadStart, DRIVE_ROUTES.uploadChunk, {
    query: { uploadType: "resumable", ...SUPPORTS_ALL_DRIVES, fields: UPLOADED_FIELDS },
    metadata: { name: plan.name, mimeType: plan.mimeType, parents: [plan.destination.id] },
    contentType: plan.mimeType,
    size: file.size,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
  return resultOf(plan, await putFile(session, handle, file, chunkBytes), file)
}

/**
 * Uploads the file `path` names, which the plan read, to the plan's
 * destination: opens it again under the upload rules (a file that is another
 * size or at another real path now is `stale`) and sends it (see `sendFile`).
 * A file the plan says goes up encrypted is encrypted first, whole, and what
 * is sent is the ciphertext; when that fails, or the plaintext is no longer
 * the plan's, nothing is sent, not even the session's start (see
 * `withCiphertext`). The handle is closed however the call ends.
 */
export async function sendUpload(
  plan: UploadPlan,
  path: string,
  ctx: ToolContext,
  chunkBytes = UPLOAD_CHUNK_BYTES,
): Promise<DriveUploadResult> {
  const opened = await openUpload(path, uploadOptions(ctx))
  try {
    if (opened.path !== plan.file.path || opened.size !== plan.file.size) throw changedFile()
    if (plan.encryption.kind !== "age") return await sendFile(plan, opened.handle, plan.file, chunkBytes)
    const { runtime } = requireRuntime(ctx, "Drive uploads")
    const { recipients } = plan.encryption
    const encrypting = { handle: opened.handle, file: plan.file, recipients, env: runtime.env, signal: ctx.signal }
    return await withCiphertext(encrypting, (ciphertext) => sendFile(plan, ciphertext.handle, ciphertext, chunkBytes))
  } finally {
    await opened.handle.close()
  }
}
