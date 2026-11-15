import { chmodSync, closeSync, lstatSync, openSync, type BigIntStats } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { ToolError } from "../errors"
import { cancelledError } from "./cancelled"
import { abortableSleep } from "./sleep"

/** Why a refresh could not start: another refresh of the same account holds the lock. */
export const REFRESH_LOCK_HELD = "Another refresh of this Google account is still running; try again shortly."

/** Owner read and write only, like the rest of a label's state. */
const FILE_MODE = 0o600

/** SQLite's primary result code for a lock held elsewhere; extended codes keep it in the low byte. */
const SQLITE_BUSY = 5
const PRIMARY_CODE_MASK = 0xff

/** How long a refresh waits for a held lock, unless told otherwise: about one call's time limit. */
const DEFAULT_WAIT_MS = 30_000

/** How often a waiting refresh tries the lock again, unless told otherwise. */
const DEFAULT_POLL_MS = 100

/** Which file a path named when it was checked. */
type FileIdentity = Pick<BigIntStats, "dev" | "ino">

/** How long and how a refresh waits for the lock. */
export type RefreshLockOptions = {
  signal?: AbortSignal
  /** How long to wait for a held lock before giving up; defaults to 30 s. */
  waitMs?: number
  /** How often to try again; defaults to 100 ms. */
  pollMs?: number
}

function lstatLock(path: string): BigIntStats | undefined {
  return lstatSync(path, { bigint: true, throwIfNoEntry: false })
}

/** Creates the file, exclusively, only when it is absent: an existing file is never opened by a raw handle, whose close can drop SQLite's locks on it. */
function createIfAbsent(path: string): void {
  if (lstatLock(path)) return
  try {
    closeSync(openSync(path, "wx", FILE_MODE))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new ToolError("not_found", `The directory of the refresh lock "${path}" does not exist.`, { cause: error })
    }
    if (code !== "EEXIST") throw error
  }
}

/** The identity of the lock file, which must be a regular file with one link and no symlink. */
function checkLockFile(path: string): FileIdentity {
  const stats = lstatLock(path)
  if (!stats) {
    throw new ToolError("stale", `The refresh lock "${path}" disappeared while it was being taken.`)
  }
  if (!stats.isFile() || stats.nlink > 1n) {
    throw new ToolError("invalid_argument", `The refresh lock "${path}" must be a regular file with a single link.`)
  }
  return { dev: stats.dev, ino: stats.ino }
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const { errcode, code } = error as { errcode?: unknown; code?: unknown }
  return (typeof errcode === "number" && (errcode & PRIMARY_CODE_MASK) === SQLITE_BUSY) || code === "SQLITE_BUSY"
}

/** Throws `stale` unless `path` still names the file that was locked. */
function checkStillThere(path: string, identity: FileIdentity): void {
  const stats = lstatLock(path)
  if (!stats || stats.dev !== identity.dev || stats.ino !== identity.ino) {
    throw new ToolError("stale", `The refresh lock "${path}" was removed or replaced while it was being taken.`)
  }
}

/**
 * Takes the refresh lock at `path`, or gives `undefined` when another
 * connection or process holds it. The returned function releases it, once;
 * the caller must keep it reachable while it holds the lock, since a
 * collected connection closes itself. The directory of `path` must exist.
 *
 * The lock is a write transaction (`BEGIN IMMEDIATE`) held on a private SQLite
 * file, with no tables and no writes. Closing the connection or losing the
 * process releases it, so no pid is stored and no holder is ever guessed to be
 * dead. The file stays in place on release: contenders must always lock the
 * same file. A lock whose file was removed or replaced meanwhile throws
 * `stale`, never recreating it.
 *
 * The file is created 0600 only when absent and must be a regular file with a
 * single link (`invalid_argument` otherwise). Any other SQLite failure, such as
 * a file that is not a database, is thrown and never read as a busy lock.
 */
function tryRefreshLock(path: string): (() => void) | undefined {
  createIfAbsent(path)
  checkLockFile(path)
  chmodSync(path, FILE_MODE)
  const identity = checkLockFile(path)

  const db = new DatabaseSync(path)
  try {
    db.exec("PRAGMA busy_timeout = 0")
    db.exec("BEGIN IMMEDIATE")
    checkStillThere(path, identity)
  } catch (error) {
    db.close()
    if (isBusy(error)) return undefined
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    db.close()
  }
}

async function waitForRefreshLock(path: string, options: RefreshLockOptions): Promise<() => void> {
  const { signal, waitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS } = options
  const deadline = Date.now() + waitMs
  for (;;) {
    if (signal?.aborted) throw cancelledError()
    const release = tryRefreshLock(path)
    if (release) return release
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new ToolError("stale", REFRESH_LOCK_HELD)
    try {
      await abortableSleep(Math.min(pollMs, remaining), signal)
    } catch (error) {
      if (signal?.aborted) throw cancelledError()
      throw error
    }
  }
}

/**
 * Runs `fn` while holding the refresh lock at `path`, one holder at a time
 * across processes, and releases it when `fn` settles. Waits up to `waitMs`,
 * trying again every `pollMs`, then throws `stale` (`REFRESH_LOCK_HELD`); a
 * cancelled `signal` throws `upstream_error`, "The call was cancelled.". The
 * directory of `path` must exist; the file is created when absent.
 */
export async function withRefreshLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: RefreshLockOptions = {},
): Promise<T> {
  const release = await waitForRefreshLock(path, options)
  try {
    return await fn()
  } finally {
    release()
  }
}
