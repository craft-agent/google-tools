import { ToolError } from "../errors"
import type { Route } from "./routes"

/** The status of a chunk that Google took in while the upload is not yet whole. */
export const HTTP_RESUME_INCOMPLETE = 308

/** A chunk that is not the last must hold a multiple of this many bytes. */
export const CHUNK_ALIGNMENT_BYTES = 256 * 1024

/** The query parameter that names an upload session in its address. */
const UPLOAD_ID_PARAMETER = "upload_id"

/** `bytes=0-N`: the bytes Google holds so far, which always start at the first. */
const RANGE_PATTERN = /^bytes=0-(\d+)$/

/** What a chunk's answer says: more is wanted from `offset`, or the upload is whole and `file` is Google's reply. */
export type ChunkReply<T> = { done: false; offset: number } | { done: true; file: T }

/** An upload session Google opened: its chunks go to an address only the session holds, never shown. */
export type ResumableSession = {
  /**
   * Sends `bytes`, which start at `offset` of `total`. A chunk that is not the
   * last must be a multiple of `CHUNK_ALIGNMENT_BYTES`. Returns the offset
   * Google wants next, or the finished file's reply. Nothing is retried.
   */
  put<T = unknown>(bytes: Uint8Array, offset: number, total: number): Promise<ChunkReply<T>>
}

function unusableSession(): ToolError {
  return new ToolError("upstream_error", "Google did not give an upload session this call can use.")
}

/**
 * The address of the upload session `location` names, when it is the chunk
 * route's own (`https`, its host and path, no user info, no fragment, an
 * `upload_id` in the query); anything else is `upstream_error` that does not
 * repeat the address, and nothing is sent to it.
 */
export function sessionUri(location: string | null, chunk: Route): URL {
  if (location === null) throw unusableSession()
  let uri: URL
  try {
    uri = new URL(location)
  } catch {
    throw unusableSession()
  }
  const valid =
    uri.protocol === "https:" &&
    uri.host === chunk.host &&
    uri.pathname === chunk.path &&
    uri.username === "" &&
    uri.password === "" &&
    uri.hash === "" &&
    (uri.searchParams.get(UPLOAD_ID_PARAMETER) ?? "") !== ""
  if (!valid) throw unusableSession()
  return uri
}

/** What identifies a session, which the client masks wherever it could show: the address as given and as used, and its `upload_id`. */
export function sessionSecrets(location: string, uri: URL): string[] {
  return [location, uri.href, uri.searchParams.get(UPLOAD_ID_PARAMETER) ?? ""].filter((secret) => secret !== "")
}

/**
 * The `Content-Range` of a chunk of `length` bytes at `offset` of `total`; a
 * chunk that cannot be one, or that is short of the alignment without being
 * the last, is `internal_error` and nothing is sent. An empty file has one
 * empty chunk, whose range names no bytes.
 */
export function contentRange(offset: number, length: number, total: number): string {
  const whole = [offset, length, total].every((value) => Number.isSafeInteger(value) && value >= 0)
  const within = whole && offset + length <= total
  const empty = total === 0 && offset === 0 && length === 0
  const last = within && offset + length === total
  if (!within || (length === 0 && !empty) || (!last && length % CHUNK_ALIGNMENT_BYTES !== 0)) {
    throw new ToolError(
      "internal_error",
      "A chunk of an upload must lie within the file and, unless last, fill 256 KiB blocks.",
    )
  }
  return empty ? "bytes */0" : `bytes ${offset}-${offset + length - 1}/${total}`
}

/**
 * The offset Google wants next, from the `Range` header of its `308` answer to
 * a chunk of `length` bytes at `offset`: one past the last byte it holds, or 0
 * when it holds none. A header this cannot read, or one that claims more than
 * has been sent, is `upstream_error`.
 */
export function nextOffset(range: string | null, offset: number, length: number): number {
  if (range === null) return 0
  const held = RANGE_PATTERN.exec(range.trim())
  const next = held === null ? Number.NaN : Number(held[1]) + 1
  if (!Number.isSafeInteger(next) || next > offset + length) {
    throw new ToolError("upstream_error", "Google answered a chunk with a range this call cannot read.")
  }
  return next
}
