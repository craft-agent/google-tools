import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Renderers for the snapshot tests that are only shell scripts, which write placeholder PNG files and log how they were called. */

const LOG_NAME = "calls.log"

/** A directory that holds nothing but the renderers written into it, to be a `PATH`. */
export async function emptyPath(made: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "renderers-"))
  made.push(dir)
  return dir
}

/** Removes the directories `emptyPath` made. */
export async function removeAll(made: string[]): Promise<void> {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
}

/**
 * Writes the executable `name` into `dir`: a shell script that logs its name
 * and arguments to `calls.log` there, then runs `body` (`sh` builtins only,
 * since `dir` is all the `PATH` there is).
 */
export async function writeRenderer(dir: string, name: string, body: string): Promise<void> {
  const script = `#!/bin/sh\necho "${name} $*" >> "${join(dir, LOG_NAME)}"\n${body}\n`
  await writeFile(join(dir, name), script)
  await chmod(join(dir, name), 0o755)
}

/** The renderers that were started in `dir`, in order, as `<name> <arguments>`. */
export async function renderCalls(dir: string): Promise<string[]> {
  const log = await readFile(join(dir, LOG_NAME), "utf8").catch(() => "")
  return log.split("\n").filter((line) => line !== "")
}

/** The body of a fake `pdftoppm` whose PDF holds `pdfPages` pages: it pads the page numbers to two digits, as the real one pads to the page count. */
export function pdftoppmBody(pdfPages: number): string {
  return [
    `last=$7; stem=$9; i=1`,
    `while [ "$i" -le "$last" ] && [ "$i" -le ${pdfPages} ]; do printf png > "$stem-0$i.png"; i=$((i+1)); done`,
  ].join("\n")
}

/** The body of a fake `magick` for a PDF of `pdfPages` pages: it numbers from 0, as ImageMagick does. */
export function magickBody(pdfPages: number): string {
  return [
    `for out; do :; done`,
    `base=\${out%"-%d.png"}; i=0`,
    `while [ "$i" -lt ${pdfPages} ]; do printf png > "$base-$i.png"; i=$((i+1)); done`,
  ].join("\n")
}

/** The body of a fake `sips`, which writes the file named after `--out`. */
export const SIPS_BODY = `printf png > "$6"`

/** The body of a renderer that runs and fails. */
export function failingBody(message: string): string {
  return `echo "${message}" >&2\nexit 3`
}
