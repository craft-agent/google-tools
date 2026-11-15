import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readJsonFile, writePrivateFile } from "./private-file"

const OWNER_ONLY = 0o600

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gprivfile-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("writePrivateFile", () => {
  test("writes the content with mode 600", async () => {
    const path = join(dir, "state.json")
    await writePrivateFile(path, '{"a":1}')
    expect(await readFile(path, "utf8")).toBe('{"a":1}')
    expect((await stat(path)).mode & 0o777).toBe(OWNER_ONLY)
  })

  test("replaces an existing file whole, and makes it private", async () => {
    const path = join(dir, "state.json")
    await writeFile(path, "old content that is longer", { mode: 0o644 })
    await writePrivateFile(path, "new")
    expect(await readFile(path, "utf8")).toBe("new")
    expect((await stat(path)).mode & 0o777).toBe(OWNER_ONLY)
  })

  test("leaves no temporary file behind", async () => {
    await writePrivateFile(join(dir, "state.json"), "x")
    await writePrivateFile(join(dir, "state.json"), "y")
    expect(await readdir(dir)).toEqual(["state.json"])
  })

  test("fails without leaving a temporary file when the target is a directory", async () => {
    await mkdir(join(dir, "state.json"))
    await expect(writePrivateFile(join(dir, "state.json"), "x")).rejects.toThrow()
    expect(await readdir(dir)).toEqual(["state.json"])
  })
})

describe("readJsonFile", () => {
  test("parses the JSON in a file", async () => {
    const path = join(dir, "state.json")
    await writeFile(path, '{"a":[1,2]}')
    expect(await readJsonFile(path)).toEqual({ a: [1, 2] })
  })

  test("is undefined for a missing file and for text that is not JSON", async () => {
    await writeFile(join(dir, "bad.json"), "{not json")
    expect(await readJsonFile(join(dir, "missing.json"))).toBeUndefined()
    expect(await readJsonFile(join(dir, "bad.json"))).toBeUndefined()
    expect(await readJsonFile(dir)).toBeUndefined()
  })
})
