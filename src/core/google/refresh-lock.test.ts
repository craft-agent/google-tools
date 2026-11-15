import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toolError } from "./client.fixtures"
import { REFRESH_LOCK_HELD, withRefreshLock } from "./refresh-lock"

let tempDir: string
let lockPath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "grefreshlock-"))
  lockPath = join(tempDir, "refresh.lock")
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/** A promise settled from outside, to hold a lock until the test lets go. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {}
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

describe("withRefreshLock", () => {
  test("returns what fn returns and creates the lock file, mode 600, which stays", async () => {
    expect(await withRefreshLock(lockPath, async () => 42)).toBe(42)
    expect(statSync(lockPath).mode & 0o777).toBe(0o600)
    expect(existsSync(lockPath)).toBe(true)
  })

  test("a second holder in the same process waits for the first", async () => {
    const events: string[] = []
    const held = gate()
    const first = withRefreshLock(lockPath, async () => {
      events.push("first in")
      await held.wait
      events.push("first out")
    })
    await Bun.sleep(30)
    const second = withRefreshLock(
      lockPath,
      async () => {
        events.push("second in")
      },
      { pollMs: 10 },
    )
    await Bun.sleep(60)
    expect(events).toEqual(["first in"])
    held.open()
    await Promise.all([first, second])
    expect(events).toEqual(["first in", "first out", "second in"])
  })

  test("gives up as stale after waitMs, naming the refresh", async () => {
    const held = gate()
    const first = withRefreshLock(lockPath, () => held.wait)
    await Bun.sleep(30)
    const error = await toolError(withRefreshLock(lockPath, async () => 1, { waitMs: 60, pollMs: 10 }))
    expect(error.code).toBe("stale")
    expect(error.message).toBe(REFRESH_LOCK_HELD)
    held.open()
    await first
  })

  test("releases the lock when fn throws, and the error goes through", async () => {
    const failure = new Error("boom")
    await expect(
      withRefreshLock(lockPath, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(await withRefreshLock(lockPath, async () => "again", { waitMs: 0 })).toBe("again")
  })

  test("a cancelled signal ends the wait as upstream_error", async () => {
    const held = gate()
    const first = withRefreshLock(lockPath, () => held.wait)
    await Bun.sleep(30)
    const controller = new AbortController()
    const waiting = toolError(withRefreshLock(lockPath, async () => 1, { signal: controller.signal, pollMs: 10 }))
    setTimeout(() => controller.abort(), 40)
    const error = await waiting
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call was cancelled.")
    held.open()
    await first
  })

  test("a signal already cancelled never runs fn", async () => {
    const controller = new AbortController()
    controller.abort()
    let ran = false
    const error = await toolError(
      withRefreshLock(
        lockPath,
        async () => {
          ran = true
        },
        { signal: controller.signal },
      ),
    )
    expect(error.code).toBe("upstream_error")
    expect(ran).toBe(false)
  })

  test("a missing directory is not_found and is not created", async () => {
    const error = await toolError(withRefreshLock(join(tempDir, "missing", "refresh.lock"), async () => 1))
    expect(error.code).toBe("not_found")
    expect(existsSync(join(tempDir, "missing"))).toBe(false)
  })
})

describe("withRefreshLock file checks", () => {
  test("a symlink is refused and its target left alone", async () => {
    const target = join(tempDir, "target")
    writeFileSync(target, "keep", { mode: 0o644 })
    symlinkSync(target, lockPath)
    expect((await toolError(withRefreshLock(lockPath, async () => 1))).code).toBe("invalid_argument")
    expect(statSync(target).mode & 0o777).toBe(0o644)
  })

  test("a directory and a hard link are refused", async () => {
    mkdirSync(lockPath)
    expect((await toolError(withRefreshLock(lockPath, async () => 1))).code).toBe("invalid_argument")
    rmSync(lockPath, { recursive: true })

    const other = join(tempDir, "other")
    writeFileSync(other, "")
    linkSync(other, lockPath)
    expect((await toolError(withRefreshLock(lockPath, async () => 1))).code).toBe("invalid_argument")
  })

  test("a file that is not a database is thrown, not read as a held lock", async () => {
    writeFileSync(lockPath, "not a database at all", { mode: 0o600 })
    await expect(withRefreshLock(lockPath, async () => 1, { waitMs: 0 })).rejects.not.toMatchObject({ code: "stale" })
  })

  test("an existing file with a wider mode is made 600", async () => {
    writeFileSync(lockPath, "", { mode: 0o644 })
    await withRefreshLock(lockPath, async () => 1)
    expect(statSync(lockPath).mode & 0o777).toBe(0o600)
  })
})
