import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ENCRYPT_DIRS_OPTION, encryptDirsOf, isUnderEncryptDirs } from "./encrypt-dirs"

const made: string[] = []

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A fresh directory, as a real path. */
async function base(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "encrypt-dirs-")))
  made.push(dir)
  return dir
}

describe("encryptDirsOf", () => {
  test("is the directories the setting names, none when it is not set", () => {
    expect(encryptDirsOf({ options: { [ENCRYPT_DIRS_OPTION]: ["/srv/secret"] } })).toEqual(["/srv/secret"])
    expect(encryptDirsOf({})).toEqual([])
    expect(encryptDirsOf({ options: { [ENCRYPT_DIRS_OPTION]: "/srv/secret" } })).toEqual([])
  })
})

describe("isUnderEncryptDirs", () => {
  test("is true for a file inside a directory and for the directory itself, false outside", async () => {
    const root = await base()
    await mkdir(join(root, "secret"))
    await mkdir(join(root, "secret2"))
    const dirs = [join(root, "secret")]

    expect(await isUnderEncryptDirs(join(root, "secret", "deep", "a.txt"), dirs)).toBe(true)
    expect(await isUnderEncryptDirs(join(root, "secret"), dirs)).toBe(true)
    expect(await isUnderEncryptDirs(join(root, "other", "a.txt"), dirs)).toBe(false)
    expect(await isUnderEncryptDirs(join(root, "secret2", "a.txt"), dirs)).toBe(false)
    expect(await isUnderEncryptDirs(join(root, "a.txt"), dirs)).toBe(false)
  })

  test("is true when any of several directories holds the file", async () => {
    const root = await base()
    await mkdir(join(root, "one"))
    await mkdir(join(root, "two"))
    expect(await isUnderEncryptDirs(join(root, "two", "a.txt"), [join(root, "one"), join(root, "two")])).toBe(true)
  })

  test("ignores case, so a differently spelled path is not taken for outside", async () => {
    const root = await base()
    await mkdir(join(root, "Secret"))
    expect(await isUnderEncryptDirs(join(root, "SECRET", "a.txt"), [join(root, "Secret")])).toBe(true)
    expect(await isUnderEncryptDirs(join(root, "secret", "a.txt"), [join(root, "SECRET-OTHER")])).toBe(false)
  })

  test("folds what lower-casing alone keeps apart", async () => {
    const root = await base()
    await mkdir(join(root, "Strasse"))
    expect(await isUnderEncryptDirs(join(root, "STRAßE", "a.txt"), [join(root, "Strasse")])).toBe(true)
  })

  test("ignores the Unicode normalization form", async () => {
    const root = await base()
    const composed = "caf\u00e9"
    const decomposed = "cafe\u0301"
    await mkdir(join(root, composed))
    expect(await isUnderEncryptDirs(join(root, decomposed, "a.txt"), [join(root, composed)])).toBe(true)
    expect(await isUnderEncryptDirs(join(root, composed, "a.txt"), [join(root, decomposed)])).toBe(true)
  })

  test("judges a directory by its real path, so a link to it names it too", async () => {
    const root = await base()
    await mkdir(join(root, "secret"))
    await symlink(join(root, "secret"), join(root, "alias"))
    expect(await isUnderEncryptDirs(join(root, "secret", "a.txt"), [join(root, "alias")])).toBe(true)
    expect(await isUnderEncryptDirs(join(root, "alias", "a.txt"), [join(root, "alias")])).toBe(false)
  })

  test("judges a directory that does not exist by the path as written, and it catches nothing elsewhere", async () => {
    const root = await base()
    await mkdir(join(root, "secret"))
    const dirs = [join(root, "missing"), join(root, "secret")]
    expect(await isUnderEncryptDirs(join(root, "MISSING", "a.txt"), [dirs[0]!])).toBe(true)
    expect(await isUnderEncryptDirs(join(root, "other", "a.txt"), [dirs[0]!])).toBe(false)
    expect(await isUnderEncryptDirs(join(root, "secret", "a.txt"), dirs)).toBe(true)
  })

  test("judges a directory that cannot be resolved by the path as written, which errs toward encrypting", async () => {
    const root = await base()
    const locked = join(root, "locked")
    await mkdir(join(locked, "inner"), { recursive: true })
    await chmod(locked, 0o000)
    try {
      expect(await isUnderEncryptDirs(join(locked, "inner", "a.txt"), [join(locked, "inner")])).toBe(true)
    } finally {
      await chmod(locked, 0o755)
    }
  })
})
