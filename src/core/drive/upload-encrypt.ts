import { createHash, type Hash } from "node:crypto"
import { constants } from "node:fs"
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolError } from "../errors"
import { AGE_EXTENSION, encryptWithAge } from "../files/age"
import { chunks, hashUpload } from "../files/upload"
import { isMissingPath } from "../google/missing-path"
import { changedFile, type UploadFile } from "./upload-plan"

/** What the private directory that holds the ciphertext is named after, in the system's temporary directory. */
const TEMP_PREFIX = "google-tools-age-"

/** What age's output is called in that directory. */
const CIPHERTEXT_NAME = `upload${AGE_EXTENSION}`

/** The mode of the ciphertext: owner only, whatever the umask made of age's own file. */
const CIPHERTEXT_MODE = 0o600

/** How many bytes of the plaintext are read at a time to give to age. */
const PLAINTEXT_CHUNK_BYTES = 1024 * 1024

/** How the ciphertext is opened: read only, never through a link. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW

/** What encrypting a file takes: the open plaintext with the plan's read of it, who to encrypt to, and what age runs under. */
export type EncryptInput = {
  handle: FileHandle
  /** The plaintext as the plan read it; what age is given must hash to `file.sha256`. */
  file: UploadFile
  recipients: readonly string[]
  /** The call's environment, of which only `PATH` reaches age. */
  env: Readonly<Record<string, string | undefined>>
  signal?: AbortSignal
}

/** The ciphertext in its temporary file: its path, size and SHA-256, and the handle it is open with. */
export type Ciphertext = UploadFile & { handle: FileHandle }

/** The first `size` bytes of the open plaintext, each piece also fed to `hash`. */
async function* hashedChunks(handle: FileHandle, size: number, hash: Hash): AsyncGenerator<Uint8Array> {
  for await (const piece of chunks(handle, size, PLAINTEXT_CHUNK_BYTES)) {
    hash.update(piece)
    yield piece
  }
}

/** Opens the ciphertext age wrote at `path`, makes it owner-only and hashes it; a file age did not write is `upstream_error`. */
async function openCiphertext(path: string): Promise<Ciphertext> {
  let handle: FileHandle
  try {
    handle = await open(path, OPEN_FLAGS)
  } catch (error) {
    if (isMissingPath(error)) throw new ToolError("upstream_error", "age finished but wrote no file.")
    throw error
  }
  try {
    await handle.chmod(CIPHERTEXT_MODE)
    const { size } = await handle.stat()
    return { handle, path, size, sha256: await hashUpload(handle, size) }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/**
 * Encrypts the plaintext with age into a fresh private temporary directory
 * (mode 700, the file 600) and gives `use` the ciphertext, open. The whole file
 * is encrypted before `use` runs, and the plaintext that age was given must
 * hash to the one the plan read, else `stale` (nothing has been sent). The
 * ciphertext's own hash is taken right after age wrote it. The handle is
 * closed and the directory removed however the call ends.
 */
export async function withCiphertext<T>(input: EncryptInput, use: (ciphertext: Ciphertext) => Promise<T>): Promise<T> {
  const { handle, file, recipients, env, signal } = input
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
  let ciphertext: Ciphertext | undefined
  try {
    const output = join(dir, CIPHERTEXT_NAME)
    const hash = createHash("sha256")
    await encryptWithAge({ recipients, output, input: hashedChunks(handle, file.size, hash), env, signal })
    if (hash.digest("hex") !== file.sha256) throw changedFile()
    ciphertext = await openCiphertext(output)
    return await use(ciphertext)
  } finally {
    await ciphertext?.handle.close()
    await rm(dir, { recursive: true, force: true })
  }
}
