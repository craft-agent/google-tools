import { constants } from "node:fs"
import { open, readdir, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { isAbortError } from "../errors"
import { exec } from "../exec"
import { MS_PER_SECOND } from "../google/fetch"

/** How long a renderer may run, in milliseconds. */
const RENDER_TIMEOUT_MS = 120_000

/** The resolution the pages are rendered at, in dots per inch. */
const RENDER_DENSITY = 110

/** Where a renderer is looked for when the environment names no `PATH`. */
const DEFAULT_PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"

/** Mode of a page image: owner only, as the PDF it is drawn from, since it holds the person's content. */
const IMAGE_MODE = 0o600

/** How a page image is opened to set its mode: never through a link. */
const IMAGE_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW

/** How much of a failed renderer's standard error the note keeps, in characters. */
const MAX_STDERR_LENGTH = 300

/** The note when no renderer is installed. */
const NO_RENDERER_NOTE = "No PDF renderer (pdftoppm, ImageMagick or sips) was found; only the PDF was saved."

/** One program that turns a PDF into page images, and how its output files are named. */
type Renderer = {
  /** The program's name, as a note names it. */
  name: string
  argv: (pdf: string, stem: string, pages: number) => string[]
  /** `numbered`: `<stem>-<n>.png` for each page; `single`: `<stem>.png` for the first page only. */
  output: "numbered" | "single"
}

/** The renderers in the order they are tried: the first one installed is used. */
const RENDERERS: readonly Renderer[] = [
  {
    name: "pdftoppm",
    argv: (pdf, stem, pages) => [
      "pdftoppm",
      "-png",
      "-r",
      String(RENDER_DENSITY),
      "-f",
      "1",
      "-l",
      String(pages),
      pdf,
      stem,
    ],
    output: "numbered",
  },
  {
    name: "magick",
    argv: (pdf, stem, pages) => [
      "magick",
      "-density",
      String(RENDER_DENSITY),
      `${pdf}[0-${pages - 1}]`,
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      `${stem}-%d.png`,
    ],
    output: "numbered",
  },
  {
    name: "sips",
    argv: (pdf, stem) => ["sips", "-s", "format", "png", pdf, "--out", `${stem}.png`],
    output: "single",
  },
]

export type RenderOptions = {
  /** The saved PDF, as an absolute path ending in `.pdf`. */
  pdf: string
  /** How many pages to render, at most. */
  pages: number
  /** The call's environment, of which only `PATH` and `HOME` reach the renderer. */
  env: Readonly<Record<string, string | undefined>>
  signal?: AbortSignal
}

/** The page images that exist, in page order, and what to tell the caller about how they came to be. */
export type Rendered = { images: string[]; note: string | null }

/** `PATH` and `HOME` only, each when the environment has it. */
function renderEnv(env: RenderOptions["env"]): Record<string, string> {
  return { PATH: env.PATH ?? DEFAULT_PATH, ...(env.HOME === undefined ? {} : { HOME: env.HOME }) }
}

/** The numbered images `<base>-<n>.png` in `dir`, in page order. Only plain names of that shape count, so nothing leaves `dir`. */
async function numberedImages(dir: string, base: string): Promise<string[]> {
  const prefix = `${base}-`
  const found: { page: number; name: string }[] = []
  for (const name of await readdir(dir)) {
    const digits = name.startsWith(prefix) && name.endsWith(".png") ? name.slice(prefix.length, -".png".length) : ""
    if (/^\d+$/.test(digits) && basename(name) === name) found.push({ page: Number(digits), name })
  }
  return found.sort((a, b) => a.page - b.page).map(({ name }) => join(dir, name))
}

/** The one image `<stem>.png`, when it exists. */
async function singleImage(stem: string): Promise<string[]> {
  const path = `${stem}.png`
  return (await stat(path).catch(() => undefined))?.isFile() ? [path] : []
}

/**
 * The images a renderer wrote, each made owner only: a renderer writes with
 * the process's umask, which usually lets others read. An image that is a
 * link, or that cannot be opened, is not listed.
 */
async function ownerOnly(paths: readonly string[]): Promise<string[]> {
  const kept: string[] = []
  for (const path of paths) {
    const handle = await open(path, IMAGE_OPEN_FLAGS).catch(() => undefined)
    if (handle === undefined) continue
    try {
      await handle.chmod(IMAGE_MODE)
      kept.push(path)
    } finally {
      await handle.close()
    }
  }
  return kept
}

function stderrTail(stderr: string, code: number): string {
  return stderr.trim().slice(-MAX_STDERR_LENGTH) || `exit code ${code}`
}

/**
 * Renders the first `pages` pages of the PDF to PNG files beside it, with the
 * first renderer installed (`pdftoppm`, `magick`, then `sips`, which draws the
 * first page only). A renderer that is not installed passes to the next; one
 * that runs and fails stops the search, and the note carries the tail of its
 * standard error. A cancelled call rejects. The renderers get `PATH` and
 * `HOME` and nothing else.
 */
export async function renderPages(options: RenderOptions): Promise<Rendered> {
  const { pdf, pages, signal } = options
  const stem = pdf.replace(/\.pdf$/, "")
  const env = renderEnv(options.env)
  for (const renderer of RENDERERS) {
    let result
    try {
      result = await exec(renderer.argv(pdf, stem, pages), { env, signal, timeoutMs: RENDER_TIMEOUT_MS })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      if (isAbortError(error)) throw error
      return { images: [], note: `${renderer.name} could not be started: ${(error as Error).message}` }
    }
    const images = await ownerOnly(
      renderer.output === "numbered" ? await numberedImages(dirname(pdf), basename(stem)) : await singleImage(stem),
    )
    if (result.timedOut) {
      return { images, note: `${renderer.name} did not finish within ${RENDER_TIMEOUT_MS / MS_PER_SECOND} s.` }
    }
    if (result.code !== 0) {
      return { images, note: `${renderer.name} failed: ${stderrTail(result.stderr, result.code)}` }
    }
    if (images.length === 0) return { images, note: `${renderer.name} ran but made no page image.` }
    const firstPageOnly = renderer.output === "single" && pages > 1
    return {
      images,
      note: firstPageOnly
        ? "Only the first page was rendered (sips draws one page); pdftoppm or ImageMagick draws more."
        : null,
    }
  }
  return { images: [], note: NO_RENDERER_NOTE }
}
