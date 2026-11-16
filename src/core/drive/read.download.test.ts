import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { invoke } from "../tool"
import { BYTES, STAMP, download, serving, saved } from "./download.testing"
import { googleDriveRead } from "./read"
import { FILE_ID, callOf, cleanUp, driveFile, fileUrl, fixture, freshTokens, refusal, respond } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_drive_read download", () => {
  test("saves the file's own bytes, owner only, named for it and the time, and returns where", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])

    const result = await h.read(download())

    const path = join(h.downloadDir, "drive", `Budget_2026-${STAMP}.pdf`)
    expect(result).toEqual({
      file_id: FILE_ID,
      name: "Budget 2026.pdf",
      mime_type: "application/pdf",
      exported: false,
      size: BYTES.byteLength,
      path,
    })
    expect(await readFile(path)).toEqual(Buffer.from(BYTES))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(h.downloadDir, "drive"))).mode & 0o777).toBe(0o700)
  })

  test("reads the metadata first, then the bytes with alt=media, never acknowledging abuse", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])

    await h.read(download())

    expect(h.calls().map(callOf)).toEqual([`GET ${fileUrl(FILE_ID)}`, `GET ${fileUrl(FILE_ID)}`])
    const [meta, media] = h.calls().map((call) => Object.fromEntries(call.url.searchParams))
    expect(meta).toMatchObject({ supportsAllDrives: "true" })
    expect(meta!.fields).toContain("capabilities(canDownload)")
    expect(meta!.alt).toBeUndefined()
    expect(media).toEqual({ alt: "media", supportsAllDrives: "true" })
  })

  test("`name` names the file, cut down to letters, digits, `_` and `-`", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])

    const result = await h.read(download({ name: "../../etc/pass wd" }))

    expect(result.path).toBe(join(h.downloadDir, "drive", `etc_pass_wd-${STAMP}.pdf`))
    expect(result.name).toBe("Budget 2026.pdf")
  })

  test.each([
    ["a plain extension, lower-cased", "scan.PDF", "pdf"],
    ["the last extension of several", "backup.tar.gz", "gz"],
    ["no extension", "README", "bin"],
    ["a hostile extension", "x.p$f;rm", "bin"],
    ["an over-long extension", "x.abcdefghijkl", "bin"],
  ])("the extension comes from the file's own name: %s", async (_name, filename, extension) => {
    const h = await fixture([serving(driveFile(FILE_ID, { name: filename }), BYTES)])

    const result = await h.read(download())

    expect(dirname(result.path!)).toBe(join(h.downloadDir, "drive"))
    expect(extname(result.path!)).toBe(`.${extension}`)
  })

  test("a file with no name is saved under its id", async () => {
    const h = await fixture([serving(driveFile(FILE_ID, { name: "" }), BYTES)])

    const result = await h.read(download())

    expect(result.path).toStartWith(join(h.downloadDir, "drive", `1MadeUpFileId_abcdefghij-0123456789-${STAMP}`))
  })

  test("a second save of the same file is a new one, and a file already there is never replaced", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])
    const existing = join(h.downloadDir, "drive", `Budget_2026-${STAMP}.pdf`)
    await mkdir(dirname(existing), { recursive: true })
    await writeFile(existing, "keep me")

    await h.read(download())
    await h.read(download())

    expect(await saved(h)).toEqual([
      `Budget_2026-${STAMP}-2.pdf`,
      `Budget_2026-${STAMP}-3.pdf`,
      `Budget_2026-${STAMP}.pdf`,
    ])
    expect(await readFile(existing, "utf8")).toBe("keep me")
  })

  test("an empty file is saved empty", async () => {
    const h = await fixture([serving(driveFile(FILE_ID, { size: "0" }), new Uint8Array(0))])

    const result = await h.read(download())

    expect(result.size).toBe(0)
    expect(await readFile(result.path!)).toEqual(Buffer.alloc(0))
  })
})

describe("google_drive_read download failures", () => {
  test("a failing fetch removes the file it began and fails as Google's error does", async () => {
    const h = await fixture([
      {
        method: "GET",
        url: fileUrl(FILE_ID),
        reply: (request) =>
          request.url.searchParams.get("alt") === "media"
            ? { status: 500, text: "oops" }
            : { json: driveFile(FILE_ID) },
      },
    ])

    expect(await toolError(h.read(download()))).toMatchObject({ code: "upstream_error" })
    expect(await saved(h)).toEqual([])
  })

  test("a file that is gone when it is fetched is not_found and nothing stays", async () => {
    const h = await fixture([
      {
        method: "GET",
        url: fileUrl(FILE_ID),
        reply: (request) =>
          request.url.searchParams.get("alt") === "media"
            ? refusal(404, "notFound", "File not found.")
            : { json: driveFile(FILE_ID) },
      },
    ])

    expect(await toolError(h.read(download()))).toMatchObject({ code: "not_found" })
    expect(await saved(h)).toEqual([])
  })

  test("a redirect is not followed and nothing stays", async () => {
    const h = await fixture([
      {
        method: "GET",
        url: fileUrl(FILE_ID),
        reply: (request) =>
          request.url.searchParams.get("alt") === "media"
            ? { status: 302, headers: { location: "https://elsewhere.test/" } }
            : { json: driveFile(FILE_ID) },
      },
    ])

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
    expect(h.requests.filter((request) => request.url.host === "elsewhere.test")).toEqual([])
    expect(await saved(h)).toEqual([])
  })

  test("a download directory inside the state directory is forbidden and nothing is written there", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])
    const ctx = { ...h.ctx, downloadDir: join(h.stateDir, "downloads") }

    const error = await toolError(invoke(googleDriveRead, download(), ctx))

    expect(error.code).toBe("forbidden")
    expect(await saved({ ...h, downloadDir: ctx.downloadDir })).toEqual([])
  })

  test("a missing or relative download directory is internal_error, before any request", async () => {
    const h = await fixture([serving(driveFile(FILE_ID), BYTES)])

    for (const downloadDir of [undefined, "relative/downloads"]) {
      const error = await toolError(invoke(googleDriveRead, download(), { ...h.ctx, downloadDir }))
      expect(error.code).toBe("internal_error")
    }
    expect(h.calls()).toHaveLength(0)
  })
})

describe("google_drive_read download refusals", () => {
  const plain = (extra: Record<string, unknown>) => driveFile(FILE_ID, extra)

  test("a folder is invalid_argument", async () => {
    const h = await fixture([
      respond(fileUrl(FILE_ID), { json: plain({ mimeType: "application/vnd.google-apps.folder" }) }),
    ])

    const error = await toolError(h.read(download()))

    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(error.message).toContain("is a folder")
    expect(h.calls()).toHaveLength(1)
    expect(await saved(h)).toEqual([])
  })

  test("a shortcut is invalid_argument naming its target", async () => {
    const h = await fixture([
      respond(fileUrl(FILE_ID), {
        json: plain({
          mimeType: "application/vnd.google-apps.shortcut",
          shortcutDetails: { targetId: "1TargetFileId", targetMimeType: "application/pdf" },
        }),
      }),
    ])

    const error = await toolError(h.read(download()))

    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(error.message).toContain("file_id 1TargetFileId")
    expect(h.calls()).toHaveLength(1)
  })

  test("a file the owner restricted is forbidden, and its bytes are never fetched", async () => {
    const h = await fixture([respond(fileUrl(FILE_ID), { json: plain({ capabilities: { canDownload: false } }) })])

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("restricted")
    expect(h.calls()).toHaveLength(1)
    expect(await saved(h)).toEqual([])
  })

  test("a file whose capabilities are not given is downloaded", async () => {
    const h = await fixture([serving(plain({ capabilities: {} }), BYTES)])

    expect((await h.read(download())).size).toBe(BYTES.byteLength)
  })

  test("a file over 2 GiB is invalid_argument before its bytes are fetched, exactly 2 GiB is not", async () => {
    const GIB2 = 2 * 1024 ** 3
    const over = await fixture([respond(fileUrl(FILE_ID), { json: plain({ size: String(GIB2 + 1) }) })])

    const error = await toolError(over.read(download()))

    expect(error).toMatchObject({
      code: "invalid_argument",
      message: `The file is ${GIB2 + 1} bytes; download saves at most 2 GiB.`,
    })
    expect(over.calls()).toHaveLength(1)
    expect(await saved(over)).toEqual([])
  })

  test("`export_type` for a file that is not exported is invalid_argument", async () => {
    const h = await fixture([respond(fileUrl(FILE_ID), { json: plain({}) })])

    const error = await toolError(h.read(download({ export_type: "pdf" })))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("applies to Google Docs, Sheets, Slides, Drawings and Apps Script files")
    expect(h.calls()).toHaveLength(1)
  })
})
