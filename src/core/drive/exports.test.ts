import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { exportFormat } from "./exports"
import {
  DOCUMENT_MIME_TYPE,
  DRAWING_MIME_TYPE,
  PRESENTATION_MIME_TYPE,
  SCRIPT_MIME_TYPE,
  SPREADSHEET_MIME_TYPE,
} from "./kinds"

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  json: "application/vnd.google-apps.script+json",
}

/** Every short name `export_type` takes. */
const ALL_NAMES = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "tsv",
  "txt",
  "html",
  "png",
  "jpeg",
  "svg",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "md",
  "zip",
  "json",
]

const FORM_MIME_TYPE = "application/vnd.google-apps.form"

describe("exportFormat", () => {
  test.each([
    ["a Doc", DOCUMENT_MIME_TYPE, "pdf", "pdf"],
    ["a Sheet", SPREADSHEET_MIME_TYPE, "xlsx", "xlsx"],
    ["a Slides file", PRESENTATION_MIME_TYPE, "pdf", "pdf"],
    ["a Drawing", DRAWING_MIME_TYPE, "png", "png"],
    ["an Apps Script file", SCRIPT_MIME_TYPE, "json", "json"],
  ] as const)("%s is exported as %s by default", (_name, mimeType, alias, extension) => {
    expect(exportFormat(mimeType, undefined)).toEqual({ mimeType: MIME[alias], extension })
  })

  /** Google's table of export formats, which the file's own doc comment cites. */
  test.each([
    ["a Doc", DOCUMENT_MIME_TYPE, ["docx", "odt", "rtf", "pdf", "txt", "html", "zip", "epub", "md"]],
    ["a Sheet", SPREADSHEET_MIME_TYPE, ["xlsx", "ods", "pdf", "zip", "csv", "tsv"]],
    ["a Slides file", PRESENTATION_MIME_TYPE, ["pptx", "odp", "pdf", "txt"]],
    ["a Drawing", DRAWING_MIME_TYPE, ["pdf", "jpeg", "png", "svg"]],
    ["an Apps Script file", SCRIPT_MIME_TYPE, ["json"]],
  ] as const)("%s takes the short names Google's table allows, and no other", (_name, mimeType, names) => {
    for (const name of names) expect(exportFormat(mimeType, name).mimeType).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
    const refused = ALL_NAMES.filter((name) => !(names as readonly string[]).includes(name))
    for (const name of refused) expect(() => exportFormat(mimeType, name)).toThrow(/cannot be exported as/)
  })

  test.each([
    [DOCUMENT_MIME_TYPE, "docx", "docx", MIME.docx],
    [DOCUMENT_MIME_TYPE, "md", "md", "text/markdown"],
    [DOCUMENT_MIME_TYPE, "html", "html", "text/html"],
    [DOCUMENT_MIME_TYPE, "zip", "zip", "application/zip"],
    [SPREADSHEET_MIME_TYPE, "csv", "csv", "text/csv"],
    [SPREADSHEET_MIME_TYPE, "tsv", "tsv", "text/tab-separated-values"],
    [DRAWING_MIME_TYPE, "jpeg", "jpg", "image/jpeg"],
    [DRAWING_MIME_TYPE, "svg", "svg", "image/svg+xml"],
    [SCRIPT_MIME_TYPE, "json", "json", MIME.json],
  ])("a %s takes %s, saved as .%s and asked for as %s", (fileType, name, extension, mimeType) => {
    expect(exportFormat(fileType, name)).toEqual({ mimeType, extension })
  })

  test("a media type, in any case and with spaces, is as good as its short name", () => {
    expect(exportFormat(DOCUMENT_MIME_TYPE, ` ${MIME.docx.toUpperCase()} `)).toEqual({
      mimeType: MIME.docx,
      extension: "docx",
    })
    expect(exportFormat(SPREADSHEET_MIME_TYPE, "PDF")).toEqual({ mimeType: MIME.pdf, extension: "pdf" })
  })

  test("a refusal lists what the kind exports as and the default", () => {
    expect(() => exportFormat(SPREADSHEET_MIME_TYPE, "docx")).toThrow(
      'A Google Sheets file cannot be exported as "docx"; it exports as xlsx, ods, pdf, zip, csv, tsv (default xlsx).',
    )
    expect(() => exportFormat(PRESENTATION_MIME_TYPE, "png")).toThrow(
      'A Google Slides file cannot be exported as "png"; it exports as pptx, odp, pdf, txt (default pdf).',
    )
    expect(() => exportFormat(DOCUMENT_MIME_TYPE, "image/gif")).toThrow(ToolError)
    expect(() => exportFormat(DOCUMENT_MIME_TYPE, "image/gif")).toThrow(/cannot be exported as "image\/gif"/)
  })

  test("another Google type has no default and takes a short name or a media type as given", () => {
    expect(() => exportFormat(FORM_MIME_TYPE, undefined)).toThrow(/no default export; give `export_type`/)
    expect(exportFormat(FORM_MIME_TYPE, "pdf")).toEqual({ mimeType: MIME.pdf, extension: "pdf" })
    expect(exportFormat(FORM_MIME_TYPE, "Application/X-Made-Up+JSON")).toEqual({
      mimeType: "application/x-made-up+json",
      extension: "bin",
    })
    expect(() => exportFormat(FORM_MIME_TYPE, "not a type")).toThrow(/neither an export short name nor a media type/)
    expect(() => exportFormat(FORM_MIME_TYPE, "a/b?c=d")).toThrow(/neither/)
  })
})
