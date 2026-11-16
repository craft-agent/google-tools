import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { BYTES, STAMP, describing, download, exporting, saved } from "./download.testing"
import {
  FILE_ID,
  GOOGLE_APPS,
  callOf,
  cleanUp,
  driveFile,
  exportUrl,
  fileUrl,
  fixture,
  freshTokens,
  refusal,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** A file of the Google editors named `name`, of the type `GOOGLE_APPS + suffix`. */
const google = (suffix: string, name = "Quarterly plan") =>
  driveFile(FILE_ID, { name, mimeType: `${GOOGLE_APPS}${suffix}`, size: undefined })

describe("google_drive_read download of a Google file", () => {
  test("exports a Doc as PDF, saves it under drive, owner only, and says it was exported", async () => {
    const h = await exporting(google("document"), BYTES, "application/pdf")

    const result = await h.read(download())

    const path = join(h.downloadDir, "drive", `Quarterly_plan-${STAMP}.pdf`)
    expect(result).toEqual({
      file_id: FILE_ID,
      name: "Quarterly plan",
      mime_type: "application/pdf",
      exported: true,
      size: BYTES.byteLength,
      path,
    })
    expect(await readFile(path)).toEqual(Buffer.from(BYTES))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test("asks Google for the export of the file, in the type it chose, and nothing else", async () => {
    const h = await exporting(google("document"), BYTES, "application/pdf")

    await h.read(download())

    expect(h.calls().map(callOf)).toEqual([`GET ${fileUrl(FILE_ID)}`, `GET ${exportUrl(FILE_ID)}`])
    expect(Object.fromEntries(h.calls()[1]!.url.searchParams)).toEqual({ mimeType: "application/pdf" })
  })

  test.each([
    ["document", "application/pdf", "pdf"],
    ["spreadsheet", XLSX, "xlsx"],
    ["presentation", "application/pdf", "pdf"],
    ["drawing", "image/png", "png"],
    ["script", "application/vnd.google-apps.script+json", "json"],
  ])("a %s is exported by default as %s", async (suffix, type, extension) => {
    const h = await exporting(google(suffix), BYTES, type)

    const result = await h.read(download())

    expect(result).toMatchObject({ mime_type: type, exported: true })
    expect(result.path).toBe(join(h.downloadDir, "drive", `Quarterly_plan-${STAMP}.${extension}`))
  })

  test.each([
    ["a short name", "docx", DOCX, "docx"],
    ["a media type", DOCX, DOCX, "docx"],
    ["a short name in capitals", "MD", "text/markdown", "md"],
    ["csv", "csv", "text/csv", "csv"],
    ["tsv", "tsv", "text/tab-separated-values", "tsv"],
  ])("export_type as %s is exported as %s", async (_name, exportType, type, extension) => {
    const suffix = ["csv", "tsv"].includes(exportType) ? "spreadsheet" : "document"
    const h = await exporting(google(suffix), BYTES, type)

    const result = await h.read(download({ export_type: exportType, name: "plan" }))

    expect(result).toMatchObject({ mime_type: type, exported: true })
    expect(result.path).toBe(join(h.downloadDir, "drive", `plan-${STAMP}.${extension}`))
    expect(h.calls()[1]!.url.searchParams.get("mimeType")).toBe(type)
  })

  test("a name with dots keeps them as text, since the extension follows the content", async () => {
    const h = await exporting(google("spreadsheet", "Plan v1.2.xlsx"), BYTES, XLSX)

    expect((await h.read(download())).path).toBe(join(h.downloadDir, "drive", `Plan_v1_2_xlsx-${STAMP}.xlsx`))
  })

  test("another Google type is refused without an export_type, and exported with one", async () => {
    const refused = await exporting(google("form"), BYTES, "application/pdf")
    const error = await toolError(refused.read(download()))
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(error.message).toContain("no default export")
    expect(refused.calls()).toHaveLength(1)

    const h = await exporting(google("form"), BYTES, "application/pdf")
    expect(await h.read(download({ export_type: "pdf" }))).toMatchObject({ exported: true })
  })

  test.each([
    ["a Sheet as docx", "spreadsheet", "docx"],
    ["a Doc as pptx", "document", "pptx"],
    ["a Drawing as csv", "drawing", "csv"],
    ["a Slides file as png", "presentation", "png"],
    ["a Doc as tsv", "document", "tsv"],
    ["a Doc as a type Google does not export", "document", "image/gif"],
  ])(
    "%s is invalid_argument, listing what is allowed, before anything is fetched",
    async (_name, suffix, exportType) => {
      const h = await fixture([describing(google(suffix))])

      const error = await toolError(h.read(download({ export_type: exportType })))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("it exports as")
      expect(h.calls()).toHaveLength(1)
      expect(await saved(h)).toEqual([])
    },
  )
})

describe("google_drive_read download of a Google file that fails", () => {
  const failing = (reply: ReturnType<typeof refusal>) =>
    fixture([describing(google("document")), { method: "GET", url: exportUrl(FILE_ID), reply }])

  test("one too large to export is invalid_argument pointing to web_view_link, and nothing stays", async () => {
    const h = await failing(refusal(403, "exportSizeLimitExceeded", "This file is too large to be exported."))

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("too large for Google to export")
    expect(error.message).toContain("10 MB")
    expect(error.message).toContain("`web_view_link`")
    expect(await saved(h)).toEqual([])
  })

  test("one Google does not export is invalid_argument pointing to web_view_link, and nothing stays", async () => {
    const h = await failing(refusal(403, "fileNotExportable", "Export only supports Docs Editors files."))

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("cannot be downloaded here")
    expect(error.message).toContain("`web_view_link`")
    expect(await saved(h)).toEqual([])
  })

  test("another refusal of the export passes as Google's error, and nothing stays", async () => {
    const h = await failing(refusal(403, "somethingElse", "Export refused for another reason."))

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Export refused for another reason.")
    expect(await saved(h)).toEqual([])
  })

  test.each([[undefined], ["pdf"]])(
    "a Google Vids file is refused, export_type %p, before the export",
    async (type) => {
      const h = await fixture([describing(google("vid", "Team video"))])

      const error = await toolError(h.read(download({ export_type: type })))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain('"Team video" is a Google Vids file, which cannot be downloaded here')
      expect(error.message).toContain("`web_view_link`")
      expect(h.calls()).toHaveLength(1)
      expect(await saved(h)).toEqual([])
    },
  )

  test("a body of another type than asked for is upstream_error, and nothing stays", async () => {
    const h = await exporting(google("document"), BYTES, "text/html")

    const error = await toolError(h.read(download()))

    expect(error.code).toBe("upstream_error")
    expect(await saved(h)).toEqual([])
  })

  test("a file the owner restricted is forbidden before the export", async () => {
    const h = await fixture([describing({ ...google("document"), capabilities: { canDownload: false } })])

    expect(await toolError(h.read(download()))).toMatchObject({ code: "forbidden" })
    expect(h.calls()).toHaveLength(1)
  })
})
