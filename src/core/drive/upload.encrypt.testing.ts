import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FakeHandler } from "../google/fake-google.testing"
import { emptyPath } from "../sheets/snapshot-renderers.testing"
import { OTHER_RECIPIENT, RECIPIENT, agePath } from "./age.testing"
import { uploadFixture } from "./upload.testing"

/** Fixtures the encrypted upload tests share: an upload directory whose `secret` subdirectory is the one `encrypt_dirs` names, and a fake age on the runtime's `PATH`. */

/** The subdirectory of the upload directory that `encrypt_dirs` names. */
export const SECRET_DIR = "secret"

/** The recipients the fixture sets: two, in the order a person might have written them. */
export const RECIPIENTS = [RECIPIENT, OTHER_RECIPIENT]

export type EncryptingOptions = {
  /** Files of the upload directory itself, by name. */
  files?: Record<string, string | Uint8Array>
  /** Files of the encryption directory, by name. */
  secrets?: Record<string, string | Uint8Array>
  /** The `age_recipients` setting; default two valid ones, `[]` for none. */
  recipients?: string[]
  /** What `encrypt_dirs` names, given the encryption directory; default that directory. */
  encryptDirs?: (secretDir: string) => string[]
  /** The body of the fake age; `null` for no age on the `PATH`; default the one that writes a known ciphertext. */
  age?: string | null
  /** The runtime's whole `PATH`, in place of the one the fixture makes for the fake age (or for no age). */
  path?: string
  handlers?: FakeHandler[]
  chunkBytes?: number
}

/**
 * The upload fixtures with the encryption directory made and holding `secrets`,
 * `encrypt_dirs` and `age_recipients` set, and a `PATH` with the fake age on
 * it (or nothing, when `age` is `null`); `bin` is where the fake logs.
 */
export async function encryptingFixture(made: string[], options: EncryptingOptions = {}) {
  const age = options.age === null ? undefined : await agePath(made, options.age)
  const path = options.path ?? age?.path ?? (await emptyPath(made))
  const h = await uploadFixture({
    files: options.files,
    handlers: options.handlers,
    chunkBytes: options.chunkBytes,
    env: { PATH: path },
    settings: (uploadDir) => ({
      encrypt_dirs: (options.encryptDirs ?? ((dir) => [dir]))(join(uploadDir, SECRET_DIR)),
      age_recipients: options.recipients ?? RECIPIENTS,
    }),
  })
  const secretDir = join(h.uploadDir, SECRET_DIR)
  await mkdir(secretDir)
  for (const [name, content] of Object.entries(options.secrets ?? {})) await writeFile(join(secretDir, name), content)
  return { ...h, bin: age?.bin ?? path, secretDir, secretPath: (name: string) => join(secretDir, name) }
}

/** A fresh directory standing in for the system's temporary one, which `use` runs under; the real one is back afterwards. */
export async function withTempDir<T>(made: string[], use: (temp: string) => Promise<T>): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), "upload-temp-"))
  made.push(temp)
  const saved = process.env.TMPDIR
  process.env.TMPDIR = temp
  try {
    return await use(temp)
  } finally {
    if (saved === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = saved
  }
}
