import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readdir, stat, truncate, writeFile } from "node:fs/promises"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { removeAll, renderCalls } from "../sheets/snapshot-renderers.testing"
import { FAKE_CIPHERTEXT_PREFIX, OTHER_RECIPIENT, RECIPIENT, outputDirModes, outputFiles } from "./age.testing"
import {
  FILES_URL,
  NEW_FILE_ID,
  ROOT_ID,
  SESSION_URI,
  SMALL_CHUNK,
  UPLOAD_URL,
  cleanUp,
  freshTokens,
  removeUploads,
} from "./upload.testing"
import { encryptingFixture, withTempDir, type EncryptingOptions } from "./upload.encrypt.testing"

const made: string[] = []

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
  await removeAll(made)
})

const CONTENT = "quarterly figures"
const CIPHERTEXT = `${FAKE_CIPHERTEXT_PREFIX}${CONTENT}`

const fixture = (options: EncryptingOptions = {}) =>
  encryptingFixture(made, { secrets: { "report.txt": CONTENT }, files: { "open.txt": CONTENT }, ...options })

type Fixture = Awaited<ReturnType<typeof fixture>>

const secretArgs = (h: Fixture, extra: Record<string, unknown> = {}) => ({ path: h.secretPath("report.txt"), ...extra })

/** A file of `size` bytes whose content varies from one byte to the next. */
const patterned = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 7) % 251))

/** The handler of the list of files already there, which changes `file` (by `change`) at the last read before the upload starts. */
const changingBefore = (change: () => Promise<void>): FakeHandler => ({
  method: "GET",
  url: FILES_URL,
  reply: async () => {
    await change()
    return { json: { files: [] } }
  },
})

describe("google_drive_upload of an encrypted file", () => {
  test("sends the ciphertext, named .age as application/octet-stream, and says it was encrypted", async () => {
    const h = await fixture()
    const result = await h.upload(secretArgs(h))

    expect(result).toEqual({
      file_id: NEW_FILE_ID,
      name: "report.txt.age",
      mime_type: "application/octet-stream",
      size: CIPHERTEXT.length,
      folder_id: ROOT_ID,
      web_view_link: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
      encrypted: { with: "age", recipients: 2 },
    })
    expect(Buffer.from(h.received()).toString()).toBe(CIPHERTEXT)
    const [start] = h.uploads()
    expect(start?.json).toEqual({ name: "report.txt.age", mimeType: "application/octet-stream", parents: [ROOT_ID] })
    expect(start?.headers["x-upload-content-type"]).toBe("application/octet-stream")
    expect(start?.headers["x-upload-content-length"]).toBe(String(CIPHERTEXT.length))
  })

  test("runs age with every recipient, sorted, and a file in a private temporary directory", async () => {
    const h = await fixture()
    await h.upload(secretArgs(h))

    const [output] = await outputFiles(h.bin)
    expect(await renderCalls(h.bin)).toEqual([
      "age --version",
      `age -r ${OTHER_RECIPIENT} -r ${RECIPIENT} -o ${output}`,
    ])
    expect(output).toContain("google-tools-age-")
    expect(await outputDirModes(h.bin)).toEqual(["drwx------"])
  })

  test("sends a large file in several chunks, the last one held until the ciphertext's own hash matches", async () => {
    const plaintext = patterned(600_000)
    const h = await fixture({ secrets: { "big.bin": plaintext } })
    const result = await h.upload({ path: h.secretPath("big.bin") })

    expect(result).toMatchObject({ size: FAKE_CIPHERTEXT_PREFIX.length + 600_000, encrypted: { recipients: 2 } })
    expect(Buffer.from(h.received()).equals(Buffer.concat([Buffer.from(FAKE_CIPHERTEXT_PREFIX), plaintext]))).toBe(true)
    const ranges = h
      .uploads()
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers["content-range"])
    expect(ranges).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${600_009}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${600_009}`,
      `bytes ${2 * SMALL_CHUNK}-600008/${600_009}`,
    ])
  })

  test("an empty file is encrypted too", async () => {
    const h = await fixture({ secrets: { "empty.txt": "" } })
    const result = await h.upload({ path: h.secretPath("empty.txt") })
    expect(result).toMatchObject({ name: "empty.txt.age", size: FAKE_CIPHERTEXT_PREFIX.length })
  })

  test("a file outside the encryption directories goes up as it is, and age is never run", async () => {
    const h = await fixture()
    const result = await h.upload({ path: `${h.uploadDir}/open.txt` })

    expect(result).toEqual({
      file_id: NEW_FILE_ID,
      name: "open.txt",
      mime_type: "text/plain",
      size: 17,
      folder_id: ROOT_ID,
      web_view_link: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
    })
    expect(Buffer.from(h.received()).toString()).toBe(CONTENT)
    expect(await renderCalls(h.bin)).toEqual([])
  })
})

describe("google_drive_upload of an encrypted file: the temporary directory", () => {
  test("is private while age writes, and the ciphertext file is owner-only when it is sent", async () => {
    let fileMode: number | undefined
    const start: FakeHandler = {
      method: "POST",
      url: UPLOAD_URL,
      reply: async () => {
        const [output] = await outputFiles(h.bin)
        fileMode = (await stat(output!)).mode & 0o777
        return { headers: { location: SESSION_URI } }
      },
    }
    const h = await fixture({ handlers: [start] })
    await h.upload(secretArgs(h))

    expect(fileMode).toBe(0o600)
    expect(await outputDirModes(h.bin)).toEqual(["drwx------"])
  })

  test("is removed after a successful upload", async () => {
    const h = await fixture()
    await withTempDir(made, async (temp) => {
      await h.upload(secretArgs(h))
      const [output] = await outputFiles(h.bin)
      expect(output?.startsWith(temp)).toBe(true)
      expect(await readdir(temp)).toEqual([])
    })
  })

  test("is removed when age fails", async () => {
    const h = await fixture({ age: `if [ "$1" = "--version" ]; then exit 0; fi\necho "disk full" >&2\nexit 1` })
    await withTempDir(made, async (temp) => {
      const error = await toolError(h.upload(secretArgs(h)))
      expect([error.code, error.message]).toEqual(["upstream_error", "age failed: disk full"])
      expect(await readdir(temp)).toEqual([])
    })
  })

  test("is removed when the upload itself fails", async () => {
    const refused: FakeHandler = { method: "POST", url: UPLOAD_URL, reply: { status: 500, json: { error: {} } } }
    const h = await fixture({ handlers: [refused] })
    await withTempDir(made, async (temp) => {
      const error = await toolError(h.upload(secretArgs(h)))
      expect(error.code).toBe("upstream_error")
      expect(await readdir(temp)).toEqual([])
    })
  })
})

describe("google_drive_upload of an encrypted file: when encrypting fails nothing is sent", () => {
  test("age missing at the run: no request, not even the session's start", async () => {
    const h = await fixture({ age: null })
    const error = await toolError(h.upload(secretArgs(h)))
    expect(error.code).toBe("upstream_error")
    expect(h.calls()).toEqual([])
    expect(h.uploads()).toEqual([])
  })

  test("age failing: no request at all, and the failure carries age's message, clipped and masked", async () => {
    const message = `ya29.fake-access-token-0000000000000001 ${"x".repeat(300)}`
    const h = await fixture({ age: `if [ "$1" = "--version" ]; then exit 0; fi\necho "${message}" >&2\nexit 1` })
    const error = await toolError(h.upload(secretArgs(h)))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`age failed: [masked] ${"x".repeat(200 - "[masked] ".length)}`)
    expect(h.uploads()).toEqual([])
    expect(h.calls().every((call) => call.url.pathname !== "/upload/drive/v3/files")).toBe(true)
  })

  test("no recipients, invalid recipients: no request", async () => {
    for (const recipients of [[], [RECIPIENT, "age1nope"]]) {
      const h = await fixture({ recipients })
      const error = await toolError(h.upload(secretArgs(h)))
      expect(["forbidden", "invalid_argument"]).toContain(error.code)
      expect(h.calls()).toEqual([])
    }
  })

  test("a plaintext whose content changed after it was read, to the same size, is stale: nothing sent", async () => {
    const path = () => `${h.secretDir}/report.txt`
    const h = await fixture({ handlers: [changingBefore(() => writeFile(path(), "QUARTERLY FIGURES"))] })
    const error = await toolError(h.upload(secretArgs(h)))

    expect(error.code).toBe("stale")
    expect(h.uploads()).toEqual([])
  })

  test("a plaintext that became shorter is stale: nothing sent", async () => {
    const cut = () => truncate(`${h.secretDir}/report.txt`, 5)
    const h = await fixture({ handlers: [changingBefore(cut)] })
    const error = await toolError(h.upload(secretArgs(h)))
    expect(error.code).toBe("stale")
    expect(h.uploads()).toEqual([])
  })
})
