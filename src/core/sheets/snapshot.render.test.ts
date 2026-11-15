import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { cleanUp, freshTokens } from "./read.testing"
import {
  SIPS_BODY,
  emptyPath,
  failingBody,
  magickBody,
  pdftoppmBody,
  removeAll,
  renderCalls,
  writeRenderer,
} from "./snapshot-renderers.testing"
import { SHEET1_STEM, snapshotArgs, snapshotFixture } from "./snapshot.testing"

const made: string[] = []

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeAll(made)
})

/** A snapshot with `renderers` (name and body) on the only `PATH` there is. */
async function snapshotWith(renderers: Record<string, string>, more: Record<string, unknown> = {}) {
  const bin = await emptyPath(made)
  for (const [name, body] of Object.entries(renderers)) await writeRenderer(bin, name, body)
  const h = await snapshotFixture({ PATH: bin })
  const result = (await h.read(snapshotArgs(more))) as { pdf: string; pages: string[]; note: string | null }
  return { bin, h, result }
}

const names = (paths: string[]) => paths.map((path) => basename(path))

describe("google_sheets_read snapshot rendering", () => {
  test("pdftoppm is used first and its pages are listed in page order", async () => {
    const { bin, result } = await snapshotWith({
      pdftoppm: pdftoppmBody(2),
      magick: magickBody(2),
      sips: SIPS_BODY,
    })

    expect(names(result.pages)).toEqual([`${SHEET1_STEM}-01.png`, `${SHEET1_STEM}-02.png`])
    expect(result.note).toBeNull()
    const [call, ...others] = await renderCalls(bin)
    expect(others).toEqual([])
    expect(call).toBe(`pdftoppm -png -r 110 -f 1 -l 3 ${result.pdf} ${result.pdf.replace(/\.pdf$/, "")}`)
  })

  test("pages beyond nine sort by number, not by name", async () => {
    const { result } = await snapshotWith({ pdftoppm: pdftoppmBody(9) }, { pages: 10 })

    expect(names(result.pages)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${SHEET1_STEM}-0${n}.png`))
    expect(result.note).toBeNull()
  })

  test("without pdftoppm, magick renders with a white background from page zero", async () => {
    const { bin, result } = await snapshotWith({ magick: magickBody(2), sips: SIPS_BODY }, { pages: 2 })

    expect(names(result.pages)).toEqual([`${SHEET1_STEM}-0.png`, `${SHEET1_STEM}-1.png`])
    expect(await renderCalls(bin)).toEqual([
      `magick -density 110 ${result.pdf}[0-1] -background white -alpha remove -alpha off ${result.pdf.replace(/\.pdf$/, "")}-%d.png`,
    ])
  })

  test("with sips alone, the first page only is rendered and the note says so", async () => {
    const { bin, result } = await snapshotWith({ sips: SIPS_BODY })

    expect(names(result.pages)).toEqual([`${SHEET1_STEM}.png`])
    expect(result.note).toContain("Only the first page was rendered")
    expect(await renderCalls(bin)).toEqual([
      `sips -s format png ${result.pdf} --out ${result.pdf.replace(/\.pdf$/, "")}.png`,
    ])
  })

  test("a renderer that runs and fails stops the search, with the tail of its standard error", async () => {
    const message = `${"x".repeat(400)}ghostscript is missing`
    const { bin, result } = await snapshotWith({ pdftoppm: failingBody(message), magick: magickBody(2) })

    expect(result.pages).toEqual([])
    expect(result.note).toStartWith("pdftoppm failed: ")
    expect(result.note!.slice("pdftoppm failed: ".length)).toBe(message.slice(-300))
    const calls = await renderCalls(bin)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toStartWith("pdftoppm ")
  })

  test("a failing renderer without a message says its exit code", async () => {
    const { result } = await snapshotWith({ pdftoppm: "exit 7" })

    expect(result.note).toBe("pdftoppm failed: exit code 7")
  })

  test("a renderer that exits cleanly with no image says so", async () => {
    const { result } = await snapshotWith({ pdftoppm: "exit 0" })

    expect(result.pages).toEqual([])
    expect(result.note).toBe("pdftoppm ran but made no page image.")
  })

  test("with no renderer on the PATH only the PDF is saved, and the note says so", async () => {
    const bin = await emptyPath(made)
    const h = await snapshotFixture({ PATH: bin })

    const result = (await h.read(snapshotArgs())) as { pdf: string; pages: string[]; note: string }

    expect(result.pages).toEqual([])
    expect(result.note).toBe("No PDF renderer (pdftoppm, ImageMagick or sips) was found; only the PDF was saved.")
    expect(await readdir(join(h.downloadDir, "sheet-snapshots"))).toEqual([basename(result.pdf)])
  })

  test("the renderer gets PATH and HOME and nothing else", async () => {
    const bin = await emptyPath(made)
    await writeRenderer(bin, "pdftoppm", `echo "HOME=$HOME SECRET=$SECRET" >> "${join(bin, "env.log")}"`)
    const h = await snapshotFixture({ PATH: bin, HOME: "/home/someone", SECRET: "hunter2" })

    await h.read(snapshotArgs())

    expect(await readFile(join(bin, "env.log"), "utf8")).toBe("HOME=/home/someone SECRET=\n")
  })
})

describe("google_sheets_read snapshot page limit", () => {
  test("a render that fills the limit says the PDF may hold more pages", async () => {
    const { result } = await snapshotWith({ pdftoppm: pdftoppmBody(9) })

    expect(result.pages).toHaveLength(3)
    expect(result.note).toBe("Rendered the first 3 pages; the PDF may hold more pages; `pages` goes up to 10.")
  })

  test("a PDF shorter than the limit has nothing to say", async () => {
    const { result } = await snapshotWith({ pdftoppm: pdftoppmBody(2) })

    expect(result.pages).toHaveLength(2)
    expect(result.note).toBeNull()
  })

  test("at the most pages the note does not offer more", async () => {
    const { result } = await snapshotWith({ pdftoppm: pdftoppmBody(20) }, { pages: 10 })

    expect(result.pages).toHaveLength(10)
    expect(result.note).toBe("Rendered the first 10 pages; the PDF may hold more pages.")
  })

  test("one page asked for and made is a limit too", async () => {
    const { result } = await snapshotWith({ pdftoppm: pdftoppmBody(5) }, { pages: 1 })

    expect(result.note).toBe("Rendered the first 1 page; the PDF may hold more pages; `pages` goes up to 10.")
  })
})
