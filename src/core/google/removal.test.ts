import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError, type ErrorCode } from "../errors"
import { CREDENTIAL } from "./client.fixtures"
import { serializeCredential } from "./credentials"
import { ensureLabelDir, stateRoot } from "./labels"
import { withRefreshLock } from "./refresh-lock"
import { removeLabel } from "./removal"

let stateDir: string
let other: string

beforeEach(async () => {
  other = await mkdtemp(join(tmpdir(), "gremoval-"))
  stateDir = join(other, "state")
})

afterEach(async () => {
  await rm(other, { recursive: true, force: true })
})

/** A label directory holding a credential file and a nested file, as a used account has. */
async function makeLabel(label: string): Promise<string> {
  const paths = await ensureLabelDir(stateDir, label)
  await writeFile(paths.credentials, serializeCredential(CREDENTIAL), { mode: 0o600 })
  await mkdir(join(paths.dir, "nested"))
  await writeFile(join(paths.dir, "nested", "file"), "x")
  return paths.dir
}

async function codeOf(run: () => Promise<unknown>): Promise<ErrorCode> {
  try {
    await run()
  } catch (error) {
    if (isToolError(error)) return error.code
    throw error
  }
  throw new Error("expected the call to throw")
}

describe("removeLabel", () => {
  test("removes the whole label and nothing beside it, leaving no detached copy", async () => {
    await makeLabel("work")
    const kept = await makeLabel("other")

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["other"])
    expect(await readFile(join(kept, "credentials.json"), "utf8")).toBe(serializeCredential(CREDENTIAL))
  })

  test("takes a label whose files cannot be read", async () => {
    const dir = await makeLabel("work")
    await chmod(join(dir, "credentials.json"), 0o000)

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })

  test("can be repeated for a label that was set up again", async () => {
    await makeLabel("work")
    await removeLabel({ stateDir, label: "work" })
    await makeLabel("work")

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })

  test("refuses a missing label", async () => {
    await makeLabel("work")

    expect(await codeOf(() => removeLabel({ stateDir, label: "absent" }))).toBe("not_found")
    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["work"])
  })

  test("refuses an invalid label", async () => {
    const dir = await makeLabel("work")

    expect(await codeOf(() => removeLabel({ stateDir, label: "../work" }))).toBe("invalid_argument")
    expect(await codeOf(() => removeLabel({ stateDir, label: "Work" }))).toBe("invalid_argument")
    expect((await stat(dir)).isDirectory()).toBe(true)
  })

  test("refuses a symlink and a plain file, leaving the symlink's target alone", async () => {
    await ensureLabelDir(stateDir, "work")
    const { accounts } = stateRoot(stateDir)
    const target = join(other, "target")
    await mkdir(target)
    await writeFile(join(target, "keep"), "x")
    await symlink(target, join(accounts, "linked"))
    await writeFile(join(accounts, "plain"), "x")

    expect(await codeOf(() => removeLabel({ stateDir, label: "linked" }))).toBe("invalid_argument")
    expect(await codeOf(() => removeLabel({ stateDir, label: "plain" }))).toBe("invalid_argument")
    expect(await readdir(target)).toEqual(["keep"])
    expect((await readdir(accounts)).sort()).toEqual(["linked", "plain", "work"])
  })

  test("waits for a refresh that holds the lock, then removes the label", async () => {
    const dir = await makeLabel("work")
    let removed = false
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const refreshing = withRefreshLock(join(dir, "refresh.lock"), () => held)
    await Bun.sleep(50)

    const removal = removeLabel({ stateDir, label: "work" }).then(() => (removed = true))
    await Bun.sleep(250)
    expect(removed).toBe(false)
    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["work"])
    release()
    await refreshing
    await removal

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })

  test("a cancellation while waiting for the lock leaves the label intact", async () => {
    const dir = await makeLabel("work")
    const controller = new AbortController()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const refreshing = withRefreshLock(join(dir, "refresh.lock"), () => held)
    await Bun.sleep(50)

    const removal = removeLabel({ stateDir, label: "work", signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    expect(await codeOf(() => removal)).toBe("upstream_error")
    release()
    await refreshing

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["work"])
  })
})

describe("removeLabel when deleting fails", () => {
  // Root ignores directory permissions, so nothing blocks the deletion there.
  test.skipIf(process.getuid?.() === 0)("names the detached directory and does not put it back", async () => {
    const dir = await makeLabel("work")
    const nested = join(dir, "nested")
    await chmod(nested, 0o500)
    try {
      let error: unknown
      try {
        await removeLabel({ stateDir, label: "work" })
      } catch (caught) {
        error = caught
      }
      if (!isToolError(error)) throw new Error("expected a ToolError")
      const { accounts } = stateRoot(stateDir)
      const detached = (await readdir(accounts)).find((name) => name.startsWith(".removed-work-"))
      expect(error.code).toBe("upstream_error")
      expect(detached).toBeDefined()
      expect(error.message).toContain(join(accounts, detached!))
      expect((await readdir(accounts)).includes("work")).toBe(false)
      await chmod(join(accounts, detached!, "nested"), 0o700)
    } finally {
      await chmod(nested, 0o700).catch(() => {})
    }
  })
})
