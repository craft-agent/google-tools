import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolError } from "../errors"
import { reserveDownload, type ReserveDownloadOptions } from "./download"

const NOW = Date.UTC(2026, 10, 15, 9, 8, 7, 654)
const STAMP = "20261115-090807"

const made: string[] = []

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "download-")))
  made.push(dir)
  return dir
}

async function reserve(downloadDir: string, overrides: Partial<ReserveDownloadOptions> = {}) {
  const reserved = await reserveDownload({
    downloadDir,
    subdir: "sheet-snapshots",
    stem: "Budget-Q1",
    extension: "pdf",
    now: NOW,
    ...overrides,
  })
  await reserved.handle.close()
  return reserved.path
}

async function refusal(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected the reservation to be refused")
}

describe("reserveDownload naming", () => {
  test("names the file after the stem and the UTC time, under the subdirectory", async () => {
    const root = await tempDir()
    expect(await reserve(root)).toBe(join(root, "sheet-snapshots", `Budget-Q1-${STAMP}.pdf`))
  })

  test("creates the directories with mode 700 and the file with mode 600", async () => {
    const root = await tempDir()
    const downloadDir = join(root, "new", "downloads")
    const path = await reserve(downloadDir)
    expect((await stat(join(downloadDir, "sheet-snapshots"))).mode & 0o777).toBe(0o700)
    expect((await stat(downloadDir)).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test("reduces the stem to letters, digits, _ and -, at most 80 characters", async () => {
    const root = await tempDir()
    expect(await reserve(root, { stem: "My Budget / 2026: Q1?" })).toBe(
      join(root, "sheet-snapshots", `My_Budget_2026_Q1-${STAMP}.pdf`),
    )
    const long = await reserve(root, { stem: "a".repeat(200) })
    expect(long).toBe(join(root, "sheet-snapshots", `${"a".repeat(80)}-${STAMP}.pdf`))
  })

  test("a stem with nothing left falls back to snapshot", async () => {
    const root = await tempDir()
    expect(await reserve(root, { stem: "家計簿" })).toBe(join(root, "sheet-snapshots", `snapshot-${STAMP}.pdf`))
    expect(await reserve(root, { stem: "../.." })).toBe(join(root, "sheet-snapshots", `snapshot-${STAMP}-2.pdf`))
  })

  test("a taken name gets -2, -3 and never replaces the file", async () => {
    const root = await tempDir()
    const first = await reserve(root)
    await writeFile(first, "kept")
    const second = await reserve(root)
    const third = await reserve(root)
    expect([second, third]).toEqual([first.replace(".pdf", "-2.pdf"), first.replace(".pdf", "-3.pdf")])
    expect(await readFile(first, "utf8")).toBe("kept")
  })

  test("gives up after 99 files of one name", async () => {
    const root = await tempDir()
    for (let copy = 0; copy < 99; copy++) await reserve(root)
    expect(await readdir(join(root, "sheet-snapshots"))).toHaveLength(99)
    expect((await refusal(reserve(root))).code).toBe("internal_error")
  })
})

describe("reserveDownload refusals", () => {
  test("a relative download directory is internal_error", async () => {
    expect((await refusal(reserve("relative/downloads"))).code).toBe("internal_error")
  })

  test("a subdirectory that is not one plain name is internal_error", async () => {
    const root = await tempDir()
    for (const subdir of ["", "..", "a/b", "a b"]) {
      expect((await refusal(reserve(root, { subdir }))).code).toBe("internal_error")
    }
  })

  test("a link at the download directory is forbidden", async () => {
    const root = await tempDir()
    await mkdir(join(root, "real"))
    await symlink(join(root, "real"), join(root, "link"))
    const error = await refusal(reserve(join(root, "link")))
    expect(error.code).toBe("forbidden")
    expect(await readdir(join(root, "real"))).toEqual([])
  })

  test("a link at the subdirectory is forbidden", async () => {
    const root = await tempDir()
    await mkdir(join(root, "elsewhere"))
    await symlink(join(root, "elsewhere"), join(root, "sheet-snapshots"))
    expect((await refusal(reserve(root))).code).toBe("forbidden")
    expect(await readdir(join(root, "elsewhere"))).toEqual([])
  })

  test("a file where the subdirectory should be is invalid_argument", async () => {
    const root = await tempDir()
    await writeFile(join(root, "sheet-snapshots"), "not a directory")
    expect((await refusal(reserve(root))).code).toBe("invalid_argument")
  })

  test("the state directory, and a directory inside it, is forbidden", async () => {
    const root = await tempDir()
    const stateDir = join(root, "state")
    await mkdir(stateDir)
    expect((await refusal(reserve(stateDir, { stateDir }))).code).toBe("forbidden")
    expect((await refusal(reserve(join(stateDir, "downloads"), { stateDir }))).code).toBe("forbidden")
    expect(await readdir(stateDir)).toEqual([])
  })

  test("a download directory that does not exist yet inside a missing state directory is forbidden, and nothing is made", async () => {
    const root = await tempDir()
    const stateDir = join(root, "state")
    expect((await refusal(reserve(join(stateDir, "a", "b"), { stateDir }))).code).toBe("forbidden")
    expect(await readdir(root)).toEqual([])
  })

  test("a link into the state directory is forbidden", async () => {
    const root = await tempDir()
    const stateDir = join(root, "state")
    await mkdir(stateDir)
    await symlink(stateDir, join(root, "shortcut"))
    expect((await refusal(reserve(join(root, "shortcut", "downloads"), { stateDir }))).code).toBe("forbidden")
    expect(await readdir(stateDir)).toEqual([])
  })

  test("the install directory, and a directory inside it, is forbidden", async () => {
    const root = await tempDir()
    const ownDir = join(root, "install")
    await mkdir(ownDir)
    expect((await refusal(reserve(ownDir, { ownDir }))).code).toBe("forbidden")
    expect((await refusal(reserve(join(ownDir, "downloads"), { ownDir }))).code).toBe("forbidden")
  })

  test("a directory beside or above the state directory is fine", async () => {
    const root = await tempDir()
    const stateDir = join(root, "state")
    await mkdir(stateDir)
    expect(await reserve(join(root, "downloads"), { stateDir })).toContain(join(root, "downloads"))
    expect(await reserve(root, { stateDir })).toContain(join(root, "sheet-snapshots"))
  })
})
