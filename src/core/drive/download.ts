import { rm } from "node:fs/promises"
import { basename, extname, isAbsolute } from "node:path"
import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import { reserveDownload } from "../files/download"
import type { GoogleClient } from "../google/client"
import type { QueryValue, Route } from "../google/routes"
import type { ToolRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { exportFormat } from "./exports"
import { SUPPORTS_ALL_DRIVES, fetchFile, fileReply, fileView } from "./file-view"
import { VIDEO_MIME_TYPE, isGoogleFile } from "./kinds"
import { DRIVE_ROUTES } from "./routes"
import {
  MAX_DOWNLOAD_BYTES,
  MAX_DOWNLOAD_GIB,
  MAX_EXPORT_MB,
  type DownloadResult,
  type DriveReadArgs,
  type FileView,
} from "./schemas"

/** The directory under the download directory that Drive files are saved in. */
const DRIVE_SUBDIR = "drive"

/** How long Google may take to send a file of up to `MAX_DOWNLOAD_GIB`. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

/** The extension of a file whose own is missing or holds anything but letters and digits. */
const FALLBACK_EXTENSION = "bin"

const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,10}$/

/** The reason of the 403 Google answers a Google file too large to export with. */
const EXPORT_TOO_LARGE_REASON = "exportSizeLimitExceeded"

/** The reason of the 403 Google answers a Google file it does not export, such as a Vids file, with. */
const NOT_EXPORTABLE_REASON = "fileNotExportable"

/** What the content-type check of a file's own bytes accepts: Drive serves whatever type the file has. */
const ANY_CONTENT_TYPE = ""

const downloadReply = fileReply.extend({
  capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
})

type DownloadArgs = Pick<DriveReadArgs, "export_type" | "name">

/** How one file is fetched and saved: the route and its query, the type the body must have, and what the saved file is. */
type Plan = {
  route: Route
  query: Record<string, QueryValue>
  accept: string
  mimeType: string
  extension: string
  exported: boolean
}

/** The plain extension of a file name, lower-cased, else `bin`. */
function plainExtension(filename: string): string {
  const extension = extname(basename(filename)).slice(1)
  return EXTENSION_PATTERN.test(extension) ? extension.toLowerCase() : FALLBACK_EXTENSION
}

/** Refuses what has no bytes to save: a folder, a shortcut, which names the file it points to, or a Google Vids file, which Google does not export. */
function refuseUnsaveable(view: FileView): void {
  if (view.mime_type === VIDEO_MIME_TYPE) throw notExportable(`${JSON.stringify(view.name)} is a Google Vids file`)
  if (view.kind === "folder") {
    throw new ToolError("invalid_argument", `${JSON.stringify(view.name)} is a folder and has no content to download.`)
  }
  if (view.kind === "shortcut") {
    const target = view.shortcut_target === undefined ? "" : ` (file_id ${view.shortcut_target.file_id})`
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(view.name)} is a shortcut; download the file it points to${target}.`,
    )
  }
}

/** How to fetch the file: an export for a file of the Google editors, its own bytes for any other, refused over `MAX_DOWNLOAD_GIB`. */
function planDownload(view: FileView, exportType: string | undefined): Plan {
  if (isGoogleFile(view.kind)) {
    const format = exportFormat(view.mime_type, exportType)
    return {
      route: DRIVE_ROUTES.export,
      query: { mimeType: format.mimeType },
      accept: format.mimeType,
      mimeType: format.mimeType,
      extension: format.extension,
      exported: true,
    }
  }
  if (exportType !== undefined) {
    throw new ToolError(
      "invalid_argument",
      "`export_type` applies to Google Docs, Sheets, Slides, Drawings and Apps Script files; this file is downloaded as it is.",
    )
  }
  if (view.size !== undefined && view.size > MAX_DOWNLOAD_BYTES) {
    throw new ToolError(
      "invalid_argument",
      `The file is ${view.size} bytes; download saves at most ${MAX_DOWNLOAD_GIB} GiB.`,
    )
  }
  return {
    route: DRIVE_ROUTES.media,
    query: { ...SUPPORTS_ALL_DRIVES, alt: "media" },
    accept: ANY_CONTENT_TYPE,
    mimeType: view.mime_type,
    extension: plainExtension(view.name),
    exported: false,
  }
}

/** The refusal of a Google file that cannot be exported: `what` says which, and the rest says where to read it instead. */
function notExportable(what: string, cause?: unknown): ToolError {
  return new ToolError(
    "invalid_argument",
    `${what}, which cannot be downloaded here: Google does not export it. Open it from its \`web_view_link\`, which \`search\` and \`file\` give.`,
    cause === undefined ? undefined : { cause },
  )
}

/** Says a Google file too large to export, or one Google does not export, is so, with a way to read it; any other failure passes as it is. */
function exportFailure(error: unknown): unknown {
  if (!isToolError(error)) return error
  if (error.details?.reason === EXPORT_TOO_LARGE_REASON) {
    return new ToolError(
      "invalid_argument",
      `The file is too large for Google to export (over ${MAX_EXPORT_MB} MB); open it from its \`web_view_link\`, which \`search\` and \`file\` give.`,
      { cause: error },
    )
  }
  if (error.details?.reason === NOT_EXPORTABLE_REASON) return notExportable("This file", error)
  return error
}

/**
 * Saves one file under the download directory (`drive`, a new file each call,
 * mode 600) and returns where. The metadata is read first: a folder, a
 * shortcut, a file the account may not download (`forbidden`) and a file over
 * `MAX_DOWNLOAD_GIB` are refused before anything is fetched. A file of the
 * Google editors is exported, in `export_type` or its kind's default, and any
 * other file is saved as it is. The file is removed when fetching it fails.
 */
export async function downloadFile(
  client: GoogleClient,
  runtime: ToolRuntime,
  ctx: ToolContext,
  fileId: string,
  args: DownloadArgs,
): Promise<DownloadResult> {
  const { downloadDir } = ctx
  if (!downloadDir || !isAbsolute(downloadDir)) {
    throw new ToolError("internal_error", "Drive downloads require an absolute download directory.")
  }
  const file = await fetchFile(client, fileId, downloadReply, "capabilities(canDownload)")
  const view = fileView(file)
  refuseUnsaveable(view)
  if (file.capabilities?.canDownload === false) {
    throw new ToolError(
      "forbidden",
      `Google does not let this account download ${JSON.stringify(view.name)}; the owner restricted downloading it.`,
    )
  }
  const plan = planDownload(view, args.export_type)
  const ownName = plan.exported ? view.name : basename(view.name, extname(view.name))

  const { path, handle } = await reserveDownload({
    downloadDir,
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    subdir: DRIVE_SUBDIR,
    stem: args.name ?? (ownName || view.file_id),
    extension: plan.extension,
    now: runtime.now(),
  })
  let bytes: number
  try {
    try {
      ;({ bytes } = await client.download(plan.route, {
        params: { file_id: view.file_id },
        query: plan.query,
        maxBytes: MAX_DOWNLOAD_BYTES,
        limitMessage: `The file is over ${MAX_DOWNLOAD_GIB} GiB, which download does not save.`,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        accept: plan.accept,
        write: (chunk) => handle.writeFile(chunk),
      }))
    } finally {
      await handle.close()
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => {})
    throw plan.exported ? exportFailure(error) : error
  }
  return {
    file_id: view.file_id,
    name: view.name,
    mime_type: plan.mimeType,
    exported: plan.exported,
    size: bytes,
    path,
  }
}
