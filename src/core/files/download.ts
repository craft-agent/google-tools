import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import { ToolError } from "../errors"

/** Mode of the directories created under the download directory: owner only. */
const DIR_MODE = 0o700

/** Mode of a downloaded file: owner only. */
const FILE_MODE = 0o600

/** How the file is opened: new, write only, and never through a link. */
const OPEN_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW

/** The longest stem a file name keeps, in characters. */
const MAX_STEM_LENGTH = 80

/** What a file is named when its stem has nothing left after sanitizing. */
const FALLBACK_STEM = "snapshot"

/** The most files of one name and second: the first has no suffix, the others `-2` to `-99`. */
const MAX_SAME_NAME = 99

/** A subdirectory name: one plain segment. */
const SUBDIR_PATTERN = /^[A-Za-z0-9_-]+$/

const UNSAFE_STEM_CHARACTERS = /[^A-Za-z0-9_-]+/g
const STEM_EDGES = /^[_-]+|[_-]+$/g

/** The directories a download must stay out of, with the words that name each in a refusal. */
type KeepOut = { path: string; name: string }

export type ReserveDownloadOptions = {
  /** The directory the `download_dir` setting names; must be absolute. */
  downloadDir: string
  /** The state root, which no download may land in. */
  stateDir?: string
  /** The directory the tools are installed in, which no download may land in. */
  ownDir?: string
  /** One plain directory name under `downloadDir`, made when missing. */
  subdir: string
  /** What the file is named for; reduced to letters, digits, `_` and `-`, at most 80 characters. */
  stem: string
  /** The file's extension, without a dot. */
  extension: string
  /** The clock in epoch milliseconds, which the file name carries as UTC. */
  now: number
}

/** A file reserved for a download: its path, and the handle it was opened with. */
export type ReservedDownload = { path: string; handle: FileHandle }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT"
}

/** What `lstat` finds at `path`, or `undefined` when nothing is there. */
async function statOrUndefined(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** The real path of `path`, or where it would be: the real path of its deepest existing ancestor with the rest appended. */
async function resolveDeep(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (!isMissing(error)) throw error
    const parent = dirname(path)
    if (parent === path) return path
    return join(await resolveDeep(parent), basename(path))
  }
}

/** Whether `path` is `root` or inside it; both are real paths. */
function isInside(path: string, root: string): boolean {
  const between = relative(root, path)
  return between === "" || !(between === ".." || between.startsWith(`..${sep}`) || isAbsolute(between))
}

/**
 * Refuses `dir` when a link stands at it, when something that is not a
 * directory does, or when its real path is one of `keepOut` or inside it.
 */
async function checkPlace(dir: string, keepOut: readonly KeepOut[]): Promise<void> {
  const stat = await statOrUndefined(dir)
  if (stat?.isSymbolicLink()) {
    throw new ToolError("forbidden", `"${dir}" is a symbolic link, and downloads are never written through a link.`)
  }
  if (stat && !stat.isDirectory()) {
    throw new ToolError("invalid_argument", `"${dir}" exists and is not a directory.`)
  }
  const real = await resolveDeep(dir)
  for (const { path, name } of keepOut) {
    if (isInside(real, await resolveDeep(path))) {
      throw new ToolError("forbidden", `Downloads are never written inside the ${name}; "${dir}" is in it.`)
    }
  }
}

/** `stem` reduced to letters, digits, `_` and `-`, at most `MAX_STEM_LENGTH` characters, never empty. */
function sanitizedStem(stem: string): string {
  const reduced = stem.replace(UNSAFE_STEM_CHARACTERS, "_").slice(0, MAX_STEM_LENGTH).replace(STEM_EDGES, "")
  return reduced === "" ? FALLBACK_STEM : reduced
}

/** `YYYYMMDD-HHMMSS` of the epoch milliseconds `now`, in UTC. */
function timestamp(now: number): string {
  return new Date(now).toISOString().slice(0, "YYYY-MM-DDTHH:MM:SS".length).replace(/[-:]/g, "").replace("T", "-")
}

/**
 * Reserves a new file `<stem>-<YYYYMMDD-HHMMSS>.<extension>` under
 * `<downloadDir>/<subdir>` and returns it open for writing, mode 600. Where a
 * file of that name exists it never replaces it: it takes `-2`, `-3` … up to
 * `-99`, and then fails.
 *
 * `downloadDir` must be absolute (`internal_error`). The directories are made
 * with mode 700 when missing. A link at `downloadDir` or at the subdirectory,
 * or a real path that is the state root or the install directory or lies
 * inside one, is `forbidden`, checked before anything is made and again after.
 */
export async function reserveDownload(options: ReserveDownloadOptions): Promise<ReservedDownload> {
  const { downloadDir, stateDir, ownDir, subdir, stem, extension, now } = options
  if (!isAbsolute(downloadDir)) {
    throw new ToolError(
      "internal_error",
      `The download directory must be absolute; got ${JSON.stringify(downloadDir)}.`,
    )
  }
  if (!SUBDIR_PATTERN.test(subdir)) {
    throw new ToolError(
      "internal_error",
      `A download subdirectory must be one plain name; got ${JSON.stringify(subdir)}.`,
    )
  }
  const keepOut: KeepOut[] = [
    ...(stateDir === undefined ? [] : [{ path: stateDir, name: "state directory" }]),
    ...(ownDir === undefined ? [] : [{ path: ownDir, name: "install directory" }]),
  ]
  const dir = join(downloadDir, subdir)

  const check = async () => {
    await checkPlace(downloadDir, keepOut)
    await checkPlace(dir, keepOut)
  }
  await check()
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  // A link put in place between the first check and the mkdir must not receive the file.
  await check()

  const base = `${sanitizedStem(stem)}-${timestamp(now)}`
  for (let copy = 1; copy <= MAX_SAME_NAME; copy++) {
    const path = join(dir, `${base}${copy === 1 ? "" : `-${copy}`}.${extension}`)
    try {
      return { path, handle: await open(path, OPEN_FLAGS, FILE_MODE) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  throw new ToolError("internal_error", `Could not find a free file name for "${base}" under "${dir}".`)
}
