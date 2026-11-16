import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { link, mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolError } from "../errors"
import {
  chunks,
  hashUpload,
  openUpload,
  readRange,
  readUpload,
  type OpenUpload,
  type ReadUploadOptions,
} from "./upload"

const MAX_BYTES = 1024 * 1024

/** The directory that lists the descriptors this process holds open. */
const OPEN_FILES = "/dev/fd"

const made: string[] = []
const opened: OpenUpload[] = []

afterEach(async () => {
  for (const file of opened.splice(0)) await file.handle.close().catch(() => {})
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** An upload directory holding `report.txt`, and the options that allow it. */
async function allowed(overrides: Partial<ReadUploadOptions> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "upload-stream-")))
  made.push(root)
  const dir = join(root, "outbox")
  await mkdir(dir)
  const file = join(dir, "report.txt")
  await writeFile(file, "quarterly figures")
  return { root, dir, file, options: { uploadDirs: [dir], maxBytes: MAX_BYTES, ...overrides } }
}

/** Opens `path`, closing the handle when the test ends. */
async function open_(path: string, options: ReadUploadOptions): Promise<OpenUpload> {
  const file = await openUpload(path, options)
  opened.push(file)
  return file
}

async function refusal(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected the call to be refused")
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const pieces: Uint8Array[] = []
  for await (const piece of source) pieces.push(piece)
  return pieces
}

const text = (piece: Uint8Array) => Buffer.from(piece).toString()

describe("openUpload", () => {
  test("gives the real path, the name, the size and an open handle that reads the file", async () => {
    const { file, options } = await allowed()
    const upload = await open_(file, options)
    expect(upload).toMatchObject({ path: file, name: "report.txt", size: 17 })
    expect(text(await readRange(upload.handle, 0, 17))).toBe("quarterly figures")
  })

  test("judges the path by its real path, as readUpload does", async () => {
    const { root, dir, file, options } = await allowed()
    const alias = join(root, "alias")
    await symlink(dir, alias)
    expect((await open_(join(alias, "report.txt"), { ...options, uploadDirs: [alias] })).path).toBe(file)
  })

  test("refuses with the codes of readUpload, and opens nothing it leaves open", async () => {
    const { root, dir, file, options } = await allowed()
    await writeFile(join(root, "elsewhere.txt"), "x")
    await symlink(file, join(dir, "alias.txt"))
    await link(join(root, "elsewhere.txt"), join(dir, "twin.txt"))
    await mkdir(join(dir, "folder"))
    const codes = async (path: string, overrides: Partial<ReadUploadOptions> = {}) =>
      (await refusal(openUpload(path, { ...options, ...overrides }))).code
    expect(await codes("report.txt")).toBe("invalid_argument")
    expect(await codes(file, { uploadDirs: [] })).toBe("forbidden")
    expect(await codes(join(root, "elsewhere.txt"))).toBe("forbidden")
    expect(await codes(join(dir, "gone.txt"))).toBe("not_found")
    expect(await codes(join(dir, "alias.txt"))).toBe("forbidden")
    expect(await codes(join(dir, "twin.txt"))).toBe("forbidden")
    expect(await codes(join(dir, "folder"))).toBe("forbidden")
    expect(await codes(file, { maxBytes: 5 })).toBe("invalid_argument")
  })

  test("a refusal after the file is open closes its handle", async () => {
    const { dir, options } = await allowed()
    await writeFile(join(dir, "big.txt"), "123456")
    const before = readdirSync(OPEN_FILES).length
    for (let attempt = 0; attempt < 20; attempt++) {
      await refusal(openUpload(join(dir, "big.txt"), { ...options, maxBytes: 5 }))
    }
    expect(readdirSync(OPEN_FILES).length).toBeLessThanOrEqual(before)
  })
})

describe("readUpload on top of openUpload", () => {
  test("still reads the bytes, the size and the hash, and closes its handle", async () => {
    const { file, options } = await allowed()
    const upload = await readUpload(file, options)
    expect(text(upload.bytes)).toBe("quarterly figures")
    expect(upload.sha256).toBe(createHash("sha256").update("quarterly figures").digest("hex"))
  })
})

describe("readRange", () => {
  test("reads from a position, fewer bytes when the file ends sooner, and none past its end", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    expect(text(await readRange(handle, 10, 3))).toBe("fig")
    expect(text(await readRange(handle, 10, 100))).toBe("figures")
    expect((await readRange(handle, 17, 4)).length).toBe(0)
  })
})

describe("chunks", () => {
  test("reads the first `size` bytes in pieces of the given size, the last shorter", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    expect((await collect(chunks(handle, 17, 6))).map(text)).toEqual(["quarte", "rly fi", "gures"])
    expect((await collect(chunks(handle, 17, 17))).map(text)).toEqual(["quarterly figures"])
    expect((await collect(chunks(handle, 17, 100))).map(text)).toEqual(["quarterly figures"])
    expect((await collect(chunks(handle, 5, 2))).map(text)).toEqual(["qu", "ar", "t"])
  })

  test("an empty file gives no piece", async () => {
    const { dir, options } = await allowed()
    await writeFile(join(dir, "empty.txt"), "")
    const { handle } = await open_(join(dir, "empty.txt"), options)
    expect(await collect(chunks(handle, 0, 8))).toEqual([])
  })

  test("a file that ended before `size` is stale when its end is reached", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    await truncate(file, 8)
    const pieces: string[] = []
    const error = await refusal(
      (async () => {
        for await (const piece of chunks(handle, 17, 6)) pieces.push(text(piece))
      })(),
    )
    expect(pieces).toEqual(["quarte"])
    expect(error.code).toBe("stale")
  })

  test("a chunk size under one byte, or not whole, is internal_error", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect([size, (await refusal(collect(chunks(handle, 17, size)))).code]).toEqual([size, "internal_error"])
    }
  })
})

describe("hashUpload", () => {
  test("is the SHA-256 of the file, whole or across pieces", async () => {
    const { dir, options } = await allowed()
    const content = Buffer.alloc(2.5 * 1024 * 1024 + 3, "ab")
    await writeFile(join(dir, "big.bin"), content)
    const { handle, size } = await open_(join(dir, "big.bin"), { ...options, maxBytes: 8 * 1024 * 1024 })
    expect(await hashUpload(handle, size)).toBe(createHash("sha256").update(content).digest("hex"))
  })

  test("hashes only the first `size` bytes, and an empty file is the hash of nothing", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    expect(await hashUpload(handle, 9)).toBe(createHash("sha256").update("quarterly").digest("hex"))
    expect(await hashUpload(handle, 0)).toBe(createHash("sha256").update("").digest("hex"))
  })

  test("a file shorter than `size` is stale", async () => {
    const { file, options } = await allowed()
    const { handle } = await open_(file, options)
    expect((await refusal(hashUpload(handle, 40))).code).toBe("stale")
  })
})
