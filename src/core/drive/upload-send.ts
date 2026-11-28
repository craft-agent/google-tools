import type { FileHandle } from "node:fs/promises"
import { UPLOAD_CHUNK_BYTES, UPLOAD_TIMEOUT_MS, putFile } from "../files/resumable-send"
import { openUpload } from "../files/upload"
import { requireRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { SUPPORTS_ALL_DRIVES, fileReply, sizeOf } from "./file-view"
import { DRIVE_ROUTES } from "./routes"
import type { DriveUploadResult } from "./upload-args"
import { withCiphertext } from "./upload-encrypt"
import { changedFile, uploadOptions, type UploadFile, type UploadPlan } from "./upload-plan"

/** The fields of the new file the final answer carries. */
const UPLOADED_FIELDS = "id,name,mimeType,size,parents,webViewLink"

/** The new file as Google answers with it, each field optional since the file exists whatever the answer lacks. */
const uploadedReply = fileReply.partial()

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
  return resultOf(plan, await putFile(session, handle, file, chunkBytes, changedFile), file)
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
