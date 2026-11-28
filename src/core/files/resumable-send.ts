import { createHash } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { ToolError } from "../errors"
import type { ResumableSession } from "../google/resumable"
import { readRange } from "./upload"

/** How many bytes one chunk of an upload holds; a multiple of the 256 KiB Google takes a chunk in. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

/** How long Google may take to open an upload and to take in each chunk. */
export const UPLOAD_TIMEOUT_MS = 120_000

/** How many times one call sends bytes again because Google took in fewer than were sent. */
const MAX_RESENDS = 3

/** What `putFile` needs to know of the file it sends: its size and the SHA-256 the plan read. */
export type SentFile = {
  size: number
  sha256: string
}

/**
 * Sends the file through `session` in chunks of `chunkBytes`, hashing what goes
 * out, and returns Google's reply to the last one. The last chunk is held
 * until the hash of everything sent with it is the one the plan read; a file
 * that changed (or ended early) throws `changed()` with the last byte unsent.
 * When Google takes in fewer bytes than were sent, the next chunk starts where
 * it says, at most `MAX_RESENDS` times (`upstream_error`).
 */
export async function putFile(
  session: ResumableSession,
  handle: FileHandle,
  file: SentFile,
  chunkBytes: number,
  changed: () => ToolError,
): Promise<unknown> {
  const hash = createHash("sha256")
  let hashed = 0
  let offset = 0
  let resends = 0
  for (;;) {
    const length = Math.min(chunkBytes, file.size - offset)
    const bytes = await readRange(handle, offset, length)
    if (bytes.length < length) throw changed()
    const end = offset + length
    if (end > hashed) {
      hash.update(bytes.subarray(hashed - offset))
      hashed = end
    }
    if (end === file.size && hash.copy().digest("hex") !== file.sha256) throw changed()

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
