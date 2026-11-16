import { ToolError } from "../errors"
import {
  DOCUMENT_MIME_TYPE,
  DRAWING_MIME_TYPE,
  PRESENTATION_MIME_TYPE,
  SCRIPT_MIME_TYPE,
  SPREADSHEET_MIME_TYPE,
} from "./kinds"

/** A format Google exports a file of its editors in: the media type it is asked for, and the extension a saved file takes. */
export type ExportFormat = { mimeType: string; extension: string }

/** The short names `export_type` takes, each for one media type. */
const FORMATS = {
  pdf: { mimeType: "application/pdf", extension: "pdf" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
  xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: "pptx" },
  csv: { mimeType: "text/csv", extension: "csv" },
  tsv: { mimeType: "text/tab-separated-values", extension: "tsv" },
  txt: { mimeType: "text/plain", extension: "txt" },
  html: { mimeType: "text/html", extension: "html" },
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  svg: { mimeType: "image/svg+xml", extension: "svg" },
  odt: { mimeType: "application/vnd.oasis.opendocument.text", extension: "odt" },
  ods: { mimeType: "application/vnd.oasis.opendocument.spreadsheet", extension: "ods" },
  odp: { mimeType: "application/vnd.oasis.opendocument.presentation", extension: "odp" },
  rtf: { mimeType: "application/rtf", extension: "rtf" },
  epub: { mimeType: "application/epub+zip", extension: "epub" },
  md: { mimeType: "text/markdown", extension: "md" },
  zip: { mimeType: "application/zip", extension: "zip" },
  json: { mimeType: `${SCRIPT_MIME_TYPE}+json`, extension: "json" },
} as const satisfies Record<string, ExportFormat>

type FormatName = keyof typeof FORMATS

/** What one kind of Google file exports as, the words that name it in a refusal and the format it takes when none is asked for. */
type KindExports = { label: string; default: FormatName; allowed: readonly FormatName[] }

/**
 * What each Google file type exports as, keyed by its media type: Google's
 * table of export formats
 * (https://developers.google.com/workspace/drive/api/guides/ref-export-formats).
 * The defaults are this package's own choice. Sheets' `csv` and `tsv` hold the
 * first sheet only; Google Vids cannot be exported at all.
 */
const EXPORTS: Readonly<Record<string, KindExports>> = {
  [DOCUMENT_MIME_TYPE]: {
    label: "Google Docs file",
    default: "pdf",
    allowed: ["docx", "odt", "rtf", "pdf", "txt", "html", "zip", "epub", "md"],
  },
  [SPREADSHEET_MIME_TYPE]: {
    label: "Google Sheets file",
    default: "xlsx",
    allowed: ["xlsx", "ods", "pdf", "zip", "csv", "tsv"],
  },
  [PRESENTATION_MIME_TYPE]: {
    label: "Google Slides file",
    default: "pdf",
    allowed: ["pptx", "odp", "pdf", "txt"],
  },
  [DRAWING_MIME_TYPE]: { label: "Google Drawings file", default: "png", allowed: ["pdf", "jpeg", "png", "svg"] },
  [SCRIPT_MIME_TYPE]: { label: "Apps Script file", default: "json", allowed: ["json"] },
}

/** What a media type that `export_type` may be is made of: a type and a subtype of plain characters. */
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

/** The extension of a file saved in a media type no short name stands for. */
const FALLBACK_EXTENSION = "bin"

function isFormatName(name: string): name is FormatName {
  return Object.hasOwn(FORMATS, name)
}

/** The short name of the format whose media type is `mimeType`, if one is. */
function nameOfMimeType(mimeType: string): FormatName | undefined {
  return (Object.keys(FORMATS) as FormatName[]).find((name) => FORMATS[name].mimeType === mimeType)
}

/** The format `exportType` names, as a short name or a media type, in any case; `undefined` when it is neither. */
function namedFormat(exportType: string): { name?: FormatName; format: ExportFormat } | undefined {
  const wanted = exportType.trim().toLowerCase()
  const name = isFormatName(wanted) ? wanted : nameOfMimeType(wanted)
  if (name !== undefined) return { name, format: FORMATS[name] }
  return MIME_TYPE_PATTERN.test(wanted) ? { format: { mimeType: wanted, extension: FALLBACK_EXTENSION } } : undefined
}

/**
 * The format to export a Google file of media type `mimeType` in. A type
 * Google's table lists takes `exportType` only when the table gives it that
 * format, and has a default; any other Google type has no default and takes
 * any short name or media type, which Google then accepts or refuses. A
 * refusal is `invalid_argument` and lists what is allowed.
 */
export function exportFormat(mimeType: string, exportType: string | undefined): ExportFormat {
  const table = Object.hasOwn(EXPORTS, mimeType) ? EXPORTS[mimeType] : undefined
  if (table === undefined) {
    if (exportType === undefined) {
      throw new ToolError(
        "invalid_argument",
        "This kind of Google file has no default export; give `export_type` (a short name such as `pdf`, or a media type).",
      )
    }
    const named = namedFormat(exportType)
    if (named === undefined) {
      throw new ToolError(
        "invalid_argument",
        `${JSON.stringify(exportType)} is neither an export short name nor a media type.`,
      )
    }
    return named.format
  }
  if (exportType === undefined) return FORMATS[table.default]
  const named = namedFormat(exportType)
  if (named?.name === undefined || !table.allowed.includes(named.name)) {
    throw new ToolError(
      "invalid_argument",
      `A ${table.label} cannot be exported as ${JSON.stringify(exportType)}; it exports as ${table.allowed.join(", ")} (default ${table.default}).`,
    )
  }
  return named.format
}
