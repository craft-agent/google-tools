import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, type FileHandle } from "node:fs/promises"
import { basename, isAbsolute, resolve } from "node:path"
import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { isInside, resolveDeep } from "./download"

/** The package setting that names the directories an upload may be read from. */
export const UPLOAD_DIRS_OPTION = "upload_dirs"

/** How the file is opened: read only, never through a link, and without waiting on a pipe. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

/** How many bytes of a file are read at a time when it is hashed. */
const HASH_CHUNK_BYTES = 1024 * 1024

export type ReadUploadOptions = {
  /** The directories the `upload_dirs` setting names; each must be absolute. Empty, nothing can be read. */
  uploadDirs: readonly string[]
  /** The state root, which no upload may be read from. */
  stateDir?: string
  /** The directory the tools are installed in, which no upload may be read from. */
  ownDir?: string
  /** The most bytes the file may hold. */
  maxBytes: number
}

/** A file read for an upload: its real path, its name, its content and the SHA-256 of that content. */
export type Upload = {
  path: string
  name: string
  bytes: Uint8Array
  size: number
  sha256: string
}

/** A file opened for an upload: its real path, its name, its size and the open handle, which the one who opened it closes. */
export type OpenUpload = {
  path: string
  name: string
  size: number
  handle: FileHandle
}

/** The directories the call's `upload_dirs` setting names; none when a person has named none. */
export function uploadDirsOf(ctx: Pick<ToolContext, "options">): readonly string[] {
  const dirs = ctx.options?.[UPLOAD_DIRS_OPTION]
  return typeof dirs === "object" ? dirs : []
}

/** The directories an upload must stay out of, with the words that name each in a refusal. */
function keepOutOf({ stateDir, ownDir }: ReadUploadOptions) {
  return [
    ...(stateDir === undefined ? [] : [{ path: stateDir, name: "state directory" }]),
    ...(ownDir === undefined ? [] : [{ path: ownDir, name: "install directory" }]),
  ]
}

/** Refuses `real`, the real path of `path`, unless it lies inside one of the upload directories and outside the directories to keep out of. */
async function checkPlace(path: string, real: string, options: ReadUploadOptions): Promise<void> {
  let allowed = false
  for (const dir of options.uploadDirs) {
    if (isInside(real, await resolveDeep(dir))) {
      allowed = true
      break
    }
  }
  if (!allowed) {
    if (options.uploadDirs.some((dir) => isInside(resolve(path), resolve(dir)))) {
      throw new ToolError(
        "forbidden",
        `"${path}" leads outside the directories the upload_dirs setting names through a link; uploads are read by their real path.`,
      )
    }
    throw new ToolError("forbidden", `"${path}" is not inside a directory the upload_dirs setting names.`)
  }
  for (const { path: root, name } of keepOutOf(options)) {
    if (isInside(real, await resolveDeep(root))) {
      throw new ToolError("forbidden", `Uploads are never read from inside the ${name}; "${path}" is in it.`)
    }
  }
}

/** The handle `path` opens as, never through a link there; a missing file is `not_found` and a link is `forbidden`. */
async function openFile(path: string): Promise<FileHandle> {
  try {
    return await open(path, OPEN_FLAGS)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") throw new ToolError("not_found", `"${path}" does not exist.`)
    if (code === "ELOOP") {
      throw new ToolError("forbidden", `"${path}" is a symbolic link, and uploads are never read through a link.`)
    }
    throw error
  }
}

/** Up to `length` bytes of the open file from `position`, fewer when it ends sooner. */
export async function readRange(handle: FileHandle, position: number, length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(bytes, filled, length - filled, position + filled)
    if (bytesRead === 0) break
    filled += bytesRead
  }
  return bytes.subarray(0, filled)
}

/**
 * The first `size` bytes of the open file in pieces of `chunkBytes` (the last
 * may be shorter), read by position. A file that ends before `size` is `stale`.
 */
export async function* chunks(handle: FileHandle, size: number, chunkBytes: number): AsyncGenerator<Uint8Array> {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) {
    throw new ToolError("internal_error", "A chunk holds at least one byte.")
  }
  for (let position = 0; position < size; position += chunkBytes) {
    const length = Math.min(chunkBytes, size - position)
    const bytes = await readRange(handle, position, length)
    if (bytes.length < length) throw new ToolError("stale", "The file is shorter than it was when it was read.")
    yield bytes
  }
}

/** The SHA-256, in lower-case hex, of the first `size` bytes of the open file, read in pieces so a large file is never held whole. */
export async function hashUpload(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash("sha256")
  for await (const piece of chunks(handle, size, HASH_CHUNK_BYTES)) hash.update(piece)
  return hash.digest("hex")
}

/**
 * Opens the file at the absolute `path` for an upload and returns its real
 * path, name, size and the open handle, which the caller closes. The file must
 * lie, by real path, inside one of the upload directories (each judged by its
 * real path) and outside the state and install directories (`forbidden`, and
 * `forbidden` as well when no upload directory is set); it is opened without
 * following a link, must be a regular file with one link, and may hold at most
 * `maxBytes` (`invalid_argument`). A relative `path` is `invalid_argument`, a
 * missing file `not_found`. The real path is checked before the file is opened
 * and again after, so a link put in place in between does not carry the read
 * elsewhere. A refusal closes the handle.
 */
export async function openUpload(path: string, options: ReadUploadOptions): Promise<OpenUpload> {
  if (!isAbsolute(path)) {
    throw new ToolError("invalid_argument", `"${path}" must be an absolute path.`)
  }
  if (options.uploadDirs.length === 0) {
    throw new ToolError("forbidden", "No upload directory is set; a person names them with the upload_dirs setting.")
  }
  const real = await resolveDeep(path)
  await checkPlace(path, real, options)

  const handle = await openFile(path)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new ToolError("forbidden", `"${path}" is not a regular file.`)
    if (stat.nlink > 1) {
      throw new ToolError("forbidden", `"${path}" has more than one hard link, so it may be a file from elsewhere.`)
    }
    if (stat.size > options.maxBytes) {
      throw new ToolError(
        "invalid_argument",
        `"${path}" is ${stat.size} bytes; at most ${options.maxBytes} bytes may be read.`,
      )
    }
    if ((await realpath(path).catch(() => undefined)) !== real) {
      throw new ToolError("forbidden", `"${path}" changed while it was being opened.`)
    }
    return { path: real, name: basename(real), size: stat.size, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Reads the whole file at `path` for an upload under the rules of `openUpload`, and hashes it. */
export async function readUpload(path: string, options: ReadUploadOptions): Promise<Upload> {
  const { handle, ...file } = await openUpload(path, options)
  try {
    const bytes = await readRange(handle, 0, file.size)
    return {
      path: file.path,
      name: file.name,
      bytes,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } finally {
    await handle.close()
  }
}
