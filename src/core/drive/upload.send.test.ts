import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILES_URL,
  FOLDER_ID,
  NEW_FILE_ID,
  ROOT_ID,
  SESSION_URI,
  SMALL_CHUNK,
  UPLOAD_URL,
  cleanUp,
  freshTokens,
  ownFolderHandlers,
  removeUploads,
  uploadFixture,
} from "./upload.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

/** A file of `size` bytes whose content varies from one byte to the next. */
const patterned = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 7) % 251))

const SIZE = 600_000

/** The directory that lists the descriptors this process holds open. */
const OPEN_FILES = "/dev/fd"

/** The `Content-Range` of each chunk the fake received, in order. */
const rangesOf = (h: Awaited<ReturnType<typeof uploadFixture>>) =>
  h
    .uploads()
    .filter((request) => request.method === "PUT")
    .map((request) => request.headers["content-range"])

/**
 * A fixture whose file `big.bin` is replaced by what `change` gives at the last
 * read before the upload starts, which lists the files already there.
 */
async function withFileChangedBeforeSending(change: (content: Buffer) => Buffer) {
  let replace: (() => Promise<void>) | undefined
  const listed: FakeHandler = {
    method: "GET",
    url: FILES_URL,
    reply: async () => {
      await replace?.()
      return { json: { files: [] } }
    },
  }
  const h = await uploadFixture({ handlers: [listed], files: { "big.bin": patterned(SIZE) } })
  const path = join(h.uploadDir, "big.bin")
  replace = () => writeFile(path, change(patterned(SIZE)))
  return { ...h, path }
}

describe("google_drive_upload", () => {
  test("uploads a small file to My Drive in one chunk and says what it made", async () => {
    const h = await uploadFixture({ files: { "report.txt": "quarterly figures" } })
    const result = await h.upload({ path: join(h.uploadDir, "report.txt") })

    expect(result).toEqual({
      file_id: NEW_FILE_ID,
      name: "report.txt",
      mime_type: "text/plain",
      size: 17,
      folder_id: ROOT_ID,
      web_view_link: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
    })
    expect(Buffer.from(h.received()).toString()).toBe("quarterly figures")
    expect(rangesOf(h)).toEqual(["bytes 0-16/17"])
  })

  test("starts the session with the file's name, type and folder as JSON, and its size", async () => {
    const h = await uploadFixture({ files: { "report.txt": "quarterly figures" } })
    await h.upload({ path: join(h.uploadDir, "report.txt") })
    const [start] = h.uploads()

    expect(start?.method).toBe("POST")
    expect(start?.json).toEqual({ name: "report.txt", mimeType: "text/plain", parents: [ROOT_ID] })
    expect(Object.fromEntries(start!.url.searchParams)).toEqual({
      uploadType: "resumable",
      supportsAllDrives: "true",
      fields: "id,name,mimeType,size,parents,webViewLink",
    })
    expect(start?.headers["x-upload-content-type"]).toBe("text/plain")
    expect(start?.headers["x-upload-content-length"]).toBe("17")
    expect(h.uploads()[1]?.url.href).toBe(SESSION_URI)
  })

  test("puts the file in an own folder, under the name and type given", async () => {
    const h = await uploadFixture({ handlers: ownFolderHandlers(), files: { "data.bin": "abc" } })
    const result = await h.upload({
      path: join(h.uploadDir, "data.bin"),
      folder: FOLDER_ID,
      name: "Data 2026",
      mime_type: "application/x-made-up",
    })

    expect(h.uploads()[0]?.json).toEqual({ name: "Data 2026", mimeType: "application/x-made-up", parents: [FOLDER_ID] })
    expect(result).toMatchObject({ name: "Data 2026", mime_type: "application/x-made-up", folder_id: FOLDER_ID })
  })

  test("takes a file of an unknown extension as application/octet-stream", async () => {
    const h = await uploadFixture({ files: { "data.unknown": "abc" } })
    expect((await h.upload({ path: join(h.uploadDir, "data.unknown") })).mime_type).toBe("application/octet-stream")
  })

  test("sends a larger file in chunks of the chunk size, the last holding the rest, and every byte arrives", async () => {
    const content = patterned(SIZE)
    const h = await uploadFixture({ files: { "big.bin": content } })
    const result = await h.upload({ path: join(h.uploadDir, "big.bin") })

    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${2 * SMALL_CHUNK}-${SIZE - 1}/${SIZE}`,
    ])
    expect(Buffer.compare(h.received(), content)).toBe(0)
    expect(result.size).toBe(SIZE)
  })

  test("a file that fills whole chunks ends on a full chunk", async () => {
    const h = await uploadFixture({ files: { "even.bin": patterned(2 * SMALL_CHUNK) } })
    await h.upload({ path: join(h.uploadDir, "even.bin") })
    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${2 * SMALL_CHUNK}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${2 * SMALL_CHUNK}`,
    ])
  })

  test("an empty file is one empty chunk", async () => {
    const h = await uploadFixture({ files: { "empty.txt": "" } })
    const result = await h.upload({ path: join(h.uploadDir, "empty.txt") })
    expect(rangesOf(h)).toEqual(["bytes */0"])
    expect(result).toMatchObject({ file_id: NEW_FILE_ID, size: 0 })
  })

  test("a final answer without fields still returns what is known: the file exists", async () => {
    const h = await uploadFixture({
      handlers: [{ method: "PUT", url: UPLOAD_URL, reply: { json: {} } }],
      files: { "report.txt": "quarterly figures" },
    })
    expect(await h.upload({ path: join(h.uploadDir, "report.txt") })).toEqual({
      file_id: "",
      name: "report.txt",
      mime_type: "text/plain",
      size: 17,
      folder_id: ROOT_ID,
      web_view_link: null,
    })
  })
})

describe("google_drive_upload when Google takes in fewer bytes than were sent", () => {
  test("sends again from the offset it says", async () => {
    const content = patterned(SIZE)
    const h = await uploadFixture({
      files: { "big.bin": content },
      session: { acknowledge: (held, _chunk, count) => (count === 2 ? SMALL_CHUNK : held) },
    })
    await h.upload({ path: join(h.uploadDir, "big.bin") })

    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${2 * SMALL_CHUNK}-${SIZE - 1}/${SIZE}`,
    ])
    expect(Buffer.compare(h.received(), content)).toBe(0)
  })

  test("gives up as upstream_error after three resends", async () => {
    const h = await uploadFixture({
      files: { "big.bin": patterned(SIZE) },
      session: { acknowledge: () => 0 },
    })
    const error = await toolError(h.upload({ path: join(h.uploadDir, "big.bin") }))
    expect(error.code).toBe("upstream_error")
    expect(rangesOf(h)).toHaveLength(4)
  })

  test("a session that holds every byte yet does not finish is upstream_error", async () => {
    const h = await uploadFixture({
      handlers: [{ method: "PUT", url: UPLOAD_URL, reply: { status: 308, headers: { range: "bytes=0-16" } } }],
      files: { "report.txt": "quarterly figures" },
    })
    expect((await toolError(h.upload({ path: join(h.uploadDir, "report.txt") }))).code).toBe("upstream_error")
    expect(rangesOf(h)).toHaveLength(1)
  })

  test("a refused chunk fails the call with Google's code and sends nothing after it", async () => {
    const h = await uploadFixture({
      handlers: [{ method: "PUT", url: UPLOAD_URL, reply: { status: 500, json: { error: { message: "backend" } } } }],
      files: { "big.bin": patterned(SIZE) },
    })
    expect((await toolError(h.upload({ path: join(h.uploadDir, "big.bin") }))).code).toBe("upstream_error")
    expect(rangesOf(h)).toHaveLength(1)
  })
})

describe("google_drive_upload when the file changes after it was read", () => {
  test("holds the last chunk and is stale when the content changed, leaving no descriptor open", async () => {
    const h = await withFileChangedBeforeSending((content) => {
      content[SIZE - 1] = content[SIZE - 1]! ^ 1
      return content
    })
    const before = readdirSync(OPEN_FILES).length
    const error = await toolError(h.upload({ path: h.path }))

    expect(error.code).toBe("stale")
    expect(error.message).toBe("The file changed after it was read; nothing was created.")
    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
    ])
    expect(readdirSync(OPEN_FILES).length).toBeLessThanOrEqual(before)
  })

  test("a change in the first byte is caught as well, before the last chunk goes", async () => {
    const h = await withFileChangedBeforeSending((content) => {
      content[0] = content[0]! ^ 1
      return content
    })
    expect((await toolError(h.upload({ path: h.path }))).code).toBe("stale")
    expect(rangesOf(h).some((range) => range?.endsWith(`${SIZE - 1}/${SIZE}`))).toBe(false)
  })

  test("a file that is another size when it is sent is stale, and no session is opened", async () => {
    const h = await withFileChangedBeforeSending((content) => content.subarray(0, SIZE - 1))
    expect((await toolError(h.upload({ path: h.path }))).code).toBe("stale")
    expect(h.uploads()).toEqual([])
  })
})

describe("google_drive_upload size", () => {
  test("a file over 2 GiB is invalid_argument, before any request", async () => {
    const h = await uploadFixture({ files: { "huge.bin": "" } })
    await truncate(join(h.uploadDir, "huge.bin"), 2 * 1024 * 1024 * 1024 + 1)
    expect((await toolError(h.upload({ path: join(h.uploadDir, "huge.bin") }))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })
})
