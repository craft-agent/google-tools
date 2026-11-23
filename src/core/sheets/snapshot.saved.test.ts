import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { invoke } from "../tool"
import { callOf, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRead } from "./read"
import {
  EXPORT_URL,
  HANDOFF_QUERY,
  HANDOFF_URL,
  PDF_BYTES,
  SHEET1_STEM,
  handoffRedirect,
  snapshotArgs,
  snapshotFixture,
} from "./snapshot.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const MIB = 1024 * 1024

type Fixture = Awaited<ReturnType<typeof snapshotFixture>>

/** What the snapshot directory holds. */
async function saved(h: Fixture): Promise<string[]> {
  return (await readdir(join(h.downloadDir, "sheet-snapshots")).catch(() => [])).sort()
}

describe("google_sheets_read snapshot file", () => {
  test("saves the PDF under the download directory, owner only, named for the sheet and the time", async () => {
    const h = await snapshotFixture()

    const result = await h.read(snapshotArgs())

    const path = join(h.downloadDir, "sheet-snapshots", `${SHEET1_STEM}.pdf`)
    expect(result).toMatchObject({ pdf: path })
    expect(await readFile(path)).toEqual(Buffer.from(PDF_BYTES))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(h.downloadDir, "sheet-snapshots"))).mode & 0o777).toBe(0o700)
  })

  test("follows the export's handoff to the download host and saves the PDF it serves", async () => {
    const h = await snapshotFixture(undefined, [
      handoffRedirect(`${HANDOFF_URL}${HANDOFF_QUERY}`),
      { method: "GET", url: HANDOFF_URL, reply: { bytes: PDF_BYTES, headers: { "content-type": "application/pdf" } } },
    ])

    const result = await h.read(snapshotArgs())

    const path = join(h.downloadDir, "sheet-snapshots", `${SHEET1_STEM}.pdf`)
    expect(result).toMatchObject({ pdf: path })
    expect(await readFile(path)).toEqual(Buffer.from(PDF_BYTES))
    const handedOff = h.calls().find((call) => call.url.host === "doc-10-60-sheets.googleusercontent.com")
    expect(handedOff?.url.search).toBe(HANDOFF_QUERY)
    expect(handedOff?.headers.authorization).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain("sig=")
  })

  test("a second snapshot of the same second is a new file, never over the first", async () => {
    const h = await snapshotFixture()

    await h.read(snapshotArgs())
    await h.read(snapshotArgs())

    expect(await saved(h)).toEqual([`${SHEET1_STEM}-2.pdf`, `${SHEET1_STEM}.pdf`])
  })

  test("the file is named for the tab it holds", async () => {
    const h = await snapshotFixture()

    await h.read(snapshotArgs({ tab: "Q1 Plan" }))

    expect(await saved(h)).toEqual(["Budget_2026-Q1_Plan-20260601-120000.pdf"])
  })
})

describe("google_sheets_read snapshot failures leave nothing behind", () => {
  test("a reply that is not a PDF is upstream_error and no file stays", async () => {
    const h = await snapshotFixture(undefined, [
      {
        method: "GET",
        url: EXPORT_URL,
        reply: { text: "<html>sign in</html>", headers: { "content-type": "text/html" } },
      },
    ])

    const error = await toolError(h.read(snapshotArgs()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google answered the export with text/html instead of application/pdf.")
    expect(await saved(h)).toEqual([])
  })

  test("an export over 30 MiB is invalid_argument and the partial file is removed", async () => {
    const h = await snapshotFixture(undefined, [
      {
        method: "GET",
        url: EXPORT_URL,
        reply: { bytes: new Uint8Array(30 * MIB + 1), headers: { "content-type": "application/pdf" } },
      },
    ])

    const error = await toolError(h.read(snapshotArgs()))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The export is over 30 MiB; snapshot a smaller range.")
    expect(await saved(h)).toEqual([])
  })

  test("a handoff to an address the route does not accept is refused and no file stays", async () => {
    const h = await snapshotFixture(undefined, [handoffRedirect("https://elsewhere.test/export/x?sig=madeUp")])

    const error = await toolError(h.read(snapshotArgs()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Google handed the export to an address this call does not accept;")
    expect(error.message).not.toContain("elsewhere.test")
    expect(h.calls().map((call) => call.url.host)).not.toContain("elsewhere.test")
    expect(await saved(h)).toEqual([])
  })

  test("a redirect from the handoff address is refused and no file stays", async () => {
    const h = await snapshotFixture(undefined, [
      handoffRedirect(`${HANDOFF_URL}${HANDOFF_QUERY}`),
      { method: "GET", url: HANDOFF_URL, reply: { status: 302, headers: { location: "https://elsewhere.test/" } } },
    ])

    const error = await toolError(h.read(snapshotArgs()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("download address answered with another redirect")
    expect(h.calls().map((call) => call.url.host)).not.toContain("elsewhere.test")
    expect(await saved(h)).toEqual([])
  })

  test("a failure status is mapped and no file stays", async () => {
    const h = await snapshotFixture(undefined, [
      { method: "GET", url: EXPORT_URL, reply: { status: 404, text: "<html>" } },
    ])

    expect((await toolError(h.read(snapshotArgs()))).code).toBe("not_found")
    expect(await saved(h)).toEqual([])
  })

  test("a cancelled export leaves no file", async () => {
    const controller = new AbortController()
    const h = await snapshotFixture(undefined, [{ method: "GET", url: EXPORT_URL, reply: () => new Promise(() => {}) }])
    const pending = toolError(invoke(googleSheetsRead, snapshotArgs(), { ...h.ctx, signal: controller.signal }))
    setTimeout(() => controller.abort(), 50)

    expect((await pending).message).toBe("The call was cancelled.")
    expect(await saved(h)).toEqual([])
  })
})

describe("google_sheets_read snapshot download directory", () => {
  test("a download directory inside the state directory is forbidden and nothing is exported", async () => {
    const h = await snapshotFixture()
    const ctx = { ...h.ctx, downloadDir: join(h.stateDir, "downloads") }

    const error = await toolError(invoke(googleSheetsRead, snapshotArgs(), ctx))

    expect(error.code).toBe("forbidden")
    expect(h.calls().map(callOf)).not.toContain(`GET ${EXPORT_URL}`)
    expect(await readdir(h.stateDir)).not.toContain("downloads")
  })

  test("the install directory is no place for a download either", async () => {
    const h = await snapshotFixture()
    const ctx = { ...h.ctx, ownDir: h.downloadDir }

    expect((await toolError(invoke(googleSheetsRead, snapshotArgs(), ctx))).code).toBe("forbidden")
  })

  test("a missing or relative download directory is internal_error", async () => {
    const h = await snapshotFixture()
    for (const downloadDir of [undefined, "relative/downloads"]) {
      const error = await toolError(invoke(googleSheetsRead, snapshotArgs(), { ...h.ctx, downloadDir }))
      expect(error.code).toBe("internal_error")
    }
    expect(h.calls()).toHaveLength(0)
  })
})
