import { ToolError } from "../errors"
import { abortError } from "../exec"
import { fileType } from "../files/mime-type"
import { hashUpload, openUpload, uploadDirsOf, type ReadUploadOptions } from "../files/upload"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { ROOT_FOLDER, folderId } from "./ids"
import { DRIVE_ROUTES } from "./routes"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_NAME_LENGTH, isPlainName, type DriveUploadArgs } from "./upload-args"
import { countSameName, readDestination, type Destination } from "./upload-destination"

/** The file an upload sends, as it was read for the plan. */
export type UploadFile = {
  /** Its real path. */
  path: string
  size: number
  sha256: string
}

/** Everything an upload is made of, read and checked: describing, targeting, measuring and sending it all plan with this. */
export type UploadPlan = {
  client: GoogleClient
  label: string
  file: UploadFile
  /** The name the file gets in Drive. */
  name: string
  mimeType: string
  destination: Destination
  /** How many files of that name are in the folder already, up to `MAX_COUNTED_FILES`; the upload adds another. */
  existing: number
}

/** What the file may be read under: the upload directories the setting names, outside the state and install directories. */
export function uploadOptions(ctx: ToolContext): ReadUploadOptions {
  return { uploadDirs: uploadDirsOf(ctx), stateDir: ctx.stateDir, ownDir: ctx.ownDir, maxBytes: MAX_UPLOAD_BYTES }
}

/**
 * Reads and checks what an upload is made of, in this order: the arguments
 * (the folder id), the label's scopes (the upload's and the read's, before any
 * request), the file (opened under the upload rules, hashed and closed), the
 * destination (see `readDestination`) and the files already there under the
 * same name. Any failure here fails the call before anything is created.
 */
export async function planUpload(args: DriveUploadArgs, ctx: ToolContext): Promise<UploadPlan> {
  const folder = folderId(args.folder ?? ROOT_FOLDER)
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, args.account, "Drive uploads")
  await client.requireScopes(DRIVE_ROUTES.uploadStart)
  await client.requireScopes(DRIVE_ROUTES.file)

  const opened = await openUpload(args.path, uploadOptions(ctx))
  let file: UploadFile
  try {
    file = { path: opened.path, size: opened.size, sha256: await hashUpload(opened.handle, opened.size) }
  } finally {
    await opened.handle.close()
  }
  const name = args.name ?? opened.name
  if (!isPlainName(name)) {
    throw new ToolError(
      "invalid_argument",
      `The file's own name is not a usable name (1 to ${MAX_UPLOAD_NAME_LENGTH} characters, no control character); give a \`name\`.`,
    )
  }

  const destination = await readDestination(client, folder, await client.accountEmail())
  const existing = await countSameName(client, destination, name)
  return { client, label, file, name, mimeType: args.mime_type ?? fileType(opened.name), destination, existing }
}
