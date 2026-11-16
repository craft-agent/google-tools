import { ToolError } from "../errors"
import { abortError } from "../exec"
import { AGE_EXTENSION, ageRecipientsOf, checkedRecipients, requireAge } from "../files/age"
import { encryptDirsOf, isUnderEncryptDirs } from "../files/encrypt-dirs"
import { fileType } from "../files/mime-type"
import { hashUpload, openUpload, uploadDirsOf, type ReadUploadOptions } from "../files/upload"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { ROOT_FOLDER, folderId } from "./ids"
import { DRIVE_ROUTES } from "./routes"
import { DRIVE_TOOLSET } from "./scopes"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_NAME_LENGTH, isPlainName, type DriveUploadArgs } from "./upload-args"
import { countSameName, readDestination, type Destination } from "./upload-destination"

/** The media type a file that goes up encrypted has: a type would say what the file is. */
export const ENCRYPTED_TYPE = "application/octet-stream"

/** The file an upload sends, as it was read for the plan. */
export type UploadFile = {
  /** Its real path. */
  path: string
  size: number
  sha256: string
}

/**
 * Whether the file goes up encrypted: `unset` when `encrypt_dirs` names no
 * directory, `outside` when the file is not under one, else `age`, with the
 * recipients (checked, without repeats, sorted) it is encrypted to.
 */
export type UploadEncryption = { kind: "unset" } | { kind: "outside" } | { kind: "age"; recipients: readonly string[] }

/** Everything an upload is made of, read and checked: describing, targeting, measuring and sending it all plan with this. */
export type UploadPlan = {
  client: GoogleClient
  label: string
  /** The file as it lies on disk, whatever is sent in its place. */
  file: UploadFile
  /** The name the file gets in Drive. */
  name: string
  mimeType: string
  encryption: UploadEncryption
  destination: Destination
  /** How many files of that name are in the folder already, up to `MAX_COUNTED_FILES`; the upload adds another. */
  existing: number
}

/** The refusal of an upload whose file is no longer what the call read; Drive makes the file only when the last byte lands, so none was made. */
export function changedFile(): ToolError {
  return new ToolError("stale", "The file changed after it was read; nothing was created.")
}

/** What the file may be read under: the upload directories the setting names, outside the state and install directories. */
export function uploadOptions(ctx: ToolContext): ReadUploadOptions {
  return { uploadDirs: uploadDirsOf(ctx), stateDir: ctx.stateDir, ownDir: ctx.ownDir, maxBytes: MAX_UPLOAD_BYTES }
}

/**
 * Whether the file at `real` goes up encrypted, and if it does, that it can:
 * the recipients are set and valid and age runs (see `checkedRecipients`,
 * `requireAge`), else the call fails here, before any request. A `mime_type`
 * beside an encrypted file is `invalid_argument`.
 */
async function planEncryption(
  real: string,
  args: DriveUploadArgs,
  ctx: ToolContext,
  env: Readonly<Record<string, string | undefined>>,
): Promise<UploadEncryption> {
  const dirs = encryptDirsOf(ctx)
  if (dirs.length === 0) return { kind: "unset" }
  if (!(await isUnderEncryptDirs(real, dirs))) return { kind: "outside" }
  if (args.mime_type !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `Files under encrypt_dirs go up as ${ENCRYPTED_TYPE}, so \`mime_type\` cannot be set for "${real}".`,
    )
  }
  const recipients = checkedRecipients(ageRecipientsOf(ctx))
  await requireAge(env, ctx.signal)
  return { kind: "age", recipients }
}

/** The name `name` becomes in Drive when its file is encrypted: `.age` is added unless it ends so already. */
function encryptedName(name: string): string {
  const named = name.endsWith(AGE_EXTENSION) ? name : `${name}${AGE_EXTENSION}`
  if (!isPlainName(named)) {
    throw new ToolError(
      "invalid_argument",
      `The name with ${AGE_EXTENSION} added is longer than ${MAX_UPLOAD_NAME_LENGTH} characters; give a shorter \`name\`.`,
    )
  }
  return named
}

/**
 * Reads and checks what an upload is made of, in this order: the arguments
 * (the folder id), the label's scopes (the upload's and the read's, before any
 * request), the file (opened under the upload rules, hashed and closed), what
 * encrypting it takes (see `planEncryption`), the destination (see
 * `readDestination`) and the files already there under the same name. Any
 * failure here fails the call before anything is created.
 */
export async function planUpload(args: DriveUploadArgs, ctx: ToolContext): Promise<UploadPlan> {
  const folder = folderId(args.folder ?? ROOT_FOLDER)
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label, runtime } = await googleSession(ctx, args.account, "Drive uploads", DRIVE_TOOLSET)
  await client.requireScopes(DRIVE_ROUTES.uploadStart)
  await client.requireScopes(DRIVE_ROUTES.file)

  const opened = await openUpload(args.path, uploadOptions(ctx))
  let file: UploadFile
  try {
    file = { path: opened.path, size: opened.size, sha256: await hashUpload(opened.handle, opened.size) }
  } finally {
    await opened.handle.close()
  }
  const given = args.name ?? opened.name
  if (!isPlainName(given)) {
    throw new ToolError(
      "invalid_argument",
      `The file's own name is not a usable name (1 to ${MAX_UPLOAD_NAME_LENGTH} characters, no control character); give a \`name\`.`,
    )
  }
  const encryption = await planEncryption(file.path, args, ctx, runtime.env)
  const encrypted = encryption.kind === "age"
  const name = encrypted ? encryptedName(given) : given

  const destination = await readDestination(client, folder, await client.accountEmail())
  const existing = await countSameName(client, destination, name)
  const mimeType = encrypted ? ENCRYPTED_TYPE : (args.mime_type ?? fileType(opened.name))
  return { client, label, file, name, mimeType, encryption, destination, existing }
}
