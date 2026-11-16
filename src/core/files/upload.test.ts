import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolError } from "../errors"
import { readUpload, uploadDirsOf, type ReadUploadOptions } from "./upload"

const MAX_BYTES = 1024

const made: string[] = []

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "upload-")))
  made.push(dir)
  return dir
}

/** An upload directory holding `report.txt`, and the options that allow it. */
async function allowed(overrides: Partial<ReadUploadOptions> = {}) {
  const root = await tempDir()
  const dir = join(root, "outbox")
  await mkdir(dir)
  const file = join(dir, "report.txt")
  await writeFile(file, "quarterly figures")
  return { root, dir, file, options: { uploadDirs: [dir], maxBytes: MAX_BYTES, ...overrides } }
}

async function refusal(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected the read to be refused")
}

describe("uploadDirsOf", () => {
  test("is the directories the setting names, and none when it is not set", () => {
    expect(uploadDirsOf({ options: { upload_dirs: ["/srv/a", "/srv/b"] } })).toEqual(["/srv/a", "/srv/b"])
    expect(uploadDirsOf({ options: {} })).toEqual([])
    expect(uploadDirsOf({})).toEqual([])
  })
})

describe("readUpload", () => {
  test("reads a regular file of an upload directory through its real path, with its name, size and SHA-256", async () => {
    const { file, options } = await allowed()
    const upload = await readUpload(file, options)
    expect(upload).toMatchObject({ path: file, name: "report.txt", size: 17 })
    expect(Buffer.from(upload.bytes).toString()).toBe("quarterly figures")
    expect(upload.sha256).toBe(createHash("sha256").update("quarterly figures").digest("hex"))
  })

  test("reads an empty file", async () => {
    const { dir, options } = await allowed()
    await writeFile(join(dir, "empty.txt"), "")
    expect(await readUpload(join(dir, "empty.txt"), options)).toMatchObject({ size: 0, name: "empty.txt" })
  })

  test("judges the path and the directory by real path: a linked upload directory reads what is inside it", async () => {
    const { root, dir, file, options } = await allowed()
    const alias = join(root, "alias")
    await symlink(dir, alias)
    const upload = await readUpload(join(alias, "report.txt"), { ...options, uploadDirs: [alias] })
    expect(upload.path).toBe(file)
  })

  test("a file at the size limit is read and one byte over is invalid_argument", async () => {
    const { dir, options } = await allowed({ maxBytes: 5 })
    await writeFile(join(dir, "five.txt"), "12345")
    await writeFile(join(dir, "six.txt"), "123456")
    expect((await readUpload(join(dir, "five.txt"), options)).size).toBe(5)
    expect((await refusal(readUpload(join(dir, "six.txt"), options))).code).toBe("invalid_argument")
  })

  test("a relative path is invalid_argument", async () => {
    const { options } = await allowed()
    expect((await refusal(readUpload("report.txt", options))).code).toBe("invalid_argument")
  })

  test("a missing file of an upload directory is not_found, and one outside it is forbidden without saying whether it exists", async () => {
    const { dir, root, options } = await allowed()
    expect((await refusal(readUpload(join(dir, "gone.txt"), options))).code).toBe("not_found")
    expect((await refusal(readUpload(join(root, "gone.txt"), options))).code).toBe("forbidden")
  })
})

describe("readUpload refusals", () => {
  test("no upload directory set: forbidden, naming the setting", async () => {
    const { file } = await allowed()
    const error = await refusal(readUpload(file, { uploadDirs: [], maxBytes: MAX_BYTES }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("No upload directory is set; a person names them with the upload_dirs setting.")
  })

  test("a file outside every upload directory is forbidden", async () => {
    const { root, options } = await allowed()
    await writeFile(join(root, "elsewhere.txt"), "x")
    expect((await refusal(readUpload(join(root, "elsewhere.txt"), options))).code).toBe("forbidden")
  })

  test("a sibling directory whose name starts like an upload directory is outside it", async () => {
    const { root, options } = await allowed()
    await mkdir(join(root, "outbox-2"))
    await writeFile(join(root, "outbox-2", "a.txt"), "x")
    expect((await refusal(readUpload(join(root, "outbox-2", "a.txt"), options))).code).toBe("forbidden")
  })

  test("a path that climbs out through .. is judged by where it lands", async () => {
    const { root, dir, options } = await allowed()
    await writeFile(join(root, "elsewhere.txt"), "x")
    expect((await refusal(readUpload(join(dir, "..", "elsewhere.txt"), options))).code).toBe("forbidden")
  })

  test("a link inside an upload directory to a file outside it is forbidden", async () => {
    const { root, dir, options } = await allowed()
    await writeFile(join(root, "secret.txt"), "x")
    await symlink(join(root, "secret.txt"), join(dir, "innocent.txt"))
    expect((await refusal(readUpload(join(dir, "innocent.txt"), options))).code).toBe("forbidden")
  })

  test("a link to a file inside the same directory is forbidden: the last component is never followed", async () => {
    const { dir, file, options } = await allowed()
    await symlink(file, join(dir, "alias.txt"))
    const error = await refusal(readUpload(join(dir, "alias.txt"), options))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("symbolic link")
  })

  test("a dangling link is forbidden, not not_found", async () => {
    const { dir, options } = await allowed()
    await symlink(join(dir, "nowhere"), join(dir, "dangling.txt"))
    expect((await refusal(readUpload(join(dir, "dangling.txt"), options))).code).toBe("forbidden")
  })

  test("a hard-linked file is forbidden, even when the other name is outside", async () => {
    const { root, dir, options } = await allowed()
    await writeFile(join(root, "secret.txt"), "x")
    await link(join(root, "secret.txt"), join(dir, "twin.txt"))
    const error = await refusal(readUpload(join(dir, "twin.txt"), options))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("hard link")
  })

  test("a directory and a pipe are not regular files and are forbidden", async () => {
    const { dir, options } = await allowed()
    await mkdir(join(dir, "folder"))
    execFileSync("mkfifo", [join(dir, "pipe")])
    for (const name of ["folder", "pipe"]) {
      const error = await refusal(readUpload(join(dir, name), options))
      expect([name, error.code, error.message]).toEqual([
        name,
        "forbidden",
        `"${join(dir, name)}" is not a regular file.`,
      ])
    }
  })

  test("a file inside the state directory is forbidden even when an upload directory holds it", async () => {
    const { root, dir, options } = await allowed({ uploadDirs: [] })
    const state = join(dir, "state")
    await mkdir(state)
    await writeFile(join(state, "credentials.json"), "x")
    const error = await refusal(
      readUpload(join(state, "credentials.json"), { ...options, uploadDirs: [root], stateDir: state }),
    )
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("state directory")
  })

  test("a file inside the install directory is forbidden even when an upload directory holds it", async () => {
    const { root, file, options } = await allowed()
    const error = await refusal(readUpload(file, { ...options, uploadDirs: [root], ownDir: options.uploadDirs[0] }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("install directory")
  })

  test("a state directory reached through a link is judged by its real path", async () => {
    const { root, dir, file, options } = await allowed()
    const alias = join(root, "state-alias")
    await symlink(dir, alias)
    const error = await refusal(readUpload(file, { ...options, uploadDirs: [root], stateDir: alias }))
    expect(error.message).toContain("state directory")
  })
})
