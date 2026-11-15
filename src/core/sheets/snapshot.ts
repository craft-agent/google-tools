import { rm } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { ToolError } from "../errors"
import { reserveDownload } from "../files/download"
import type { GoogleClient } from "../google/client"
import type { QueryValue } from "../google/routes"
import type { ToolRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { quoteTab, splitRange, type GridBounds } from "./a1"
import { SHEETS_ROUTES } from "./routes"
import {
  DEFAULT_SNAPSHOT_PAGES,
  MAX_SNAPSHOT_PAGES,
  type SheetsReadArgs,
  type SnapshotFit,
  type SnapshotResult,
} from "./schemas"
import { renderPages } from "./snapshot-render"
import { readTabs, tabOfRange, type SheetTab } from "./tabs"

/** The directory under the download directory that snapshots are saved in. */
const SNAPSHOT_SUBDIR = "sheet-snapshots"

/** The most bytes of PDF a snapshot takes. */
const MAX_EXPORT_BYTES = 30 * 1024 * 1024

/** How long Google may take to render and send the PDF of a large tab. */
const EXPORT_TIMEOUT_MS = 120_000

/** The export's `scale` parameter for each way of fitting the sheet to the paper. */
const FIT_SCALES: Record<SnapshotFit, number> = { width: 2, height: 3, page: 4, none: 1 }

/** The export's value for a page number it should not print. */
const NO_PAGE_NUMBER = "UNDEFINED"

/** A closed block's corners: column letters and row number, `$` allowed. */
const CLOSED_BLOCK_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$/

const ALPHABET_SIZE = 26
const FIRST_LETTER_CODE = "A".charCodeAt(0)

/** How much of a refused range an error repeats. */
const MAX_SHOWN_LENGTH = 100

type SnapshotArgs = Pick<SheetsReadArgs, "tab" | "range" | "pages" | "fit" | "paper" | "portrait" | "gridlines">

/** The zero-based index of a column's letters: `A` is 0, `Z` is 25, `AA` is 26. */
function columnIndex(letters: string): number {
  let index = 0
  for (const letter of letters.toUpperCase())
    index = index * ALPHABET_SIZE + letter.charCodeAt(0) - FIRST_LETTER_CODE + 1
  return index - 1
}

/** The zero-based, end-exclusive bounds of the closed block `cells` (`A1:F40`, corners in any order), or `undefined` when it is not one. */
function closedBlock(cells: string): Required<GridBounds> | undefined {
  const match = CLOSED_BLOCK_PATTERN.exec(cells)
  if (match === null) return undefined
  const rows = [Number(match[2]), Number(match[4])]
  const columns = [columnIndex(match[1]!), columnIndex(match[3]!)]
  if (rows.some((row) => row < 1)) return undefined
  return {
    startRowIndex: Math.min(...rows) - 1,
    endRowIndex: Math.max(...rows),
    startColumnIndex: Math.min(...columns),
    endColumnIndex: Math.max(...columns) + 1,
  }
}

/** What a `range` argument names: the tab it carries (none for bare cells) and its block; anything else is `invalid_argument`. */
function parsedRange(range: string): { tab: string | undefined; block: Required<GridBounds> } {
  const shown = range.length > MAX_SHOWN_LENGTH ? `${range.slice(0, MAX_SHOWN_LENGTH)}…` : range
  const parts = splitRange(range)
  if (parts === undefined) {
    throw new ToolError("invalid_argument", `${JSON.stringify(shown)} is not a range in A1 notation.`)
  }
  const block = closedBlock(parts.cells)
  if (block === undefined) {
    throw new ToolError(
      "invalid_argument",
      `Method snapshot takes a closed block with both corners, such as 'Sheet1'!A1:F40, not ${JSON.stringify(shown)}; leave \`range\` out for the whole tab.`,
    )
  }
  return { tab: parts.tab, block }
}

/** The tab to export: the one `range` names, else the one `tab` names, else the first; two different tabs are `invalid_argument`. */
function chosenTab(tabs: readonly SheetTab[], args: SnapshotArgs, rangeTab: string | undefined): SheetTab {
  const fromRange = rangeTab === undefined ? undefined : tabOfRange(tabs, args.range!)
  const fromTab = args.tab === undefined ? undefined : tabOfRange(tabs, quoteTab(args.tab))
  if (fromRange && fromTab && fromRange.sheetId !== fromTab.sheetId) {
    throw new ToolError(
      "invalid_argument",
      `\`range\` names the tab ${JSON.stringify(fromRange.title)} but \`tab\` names ${JSON.stringify(fromTab.title)}; give one tab.`,
    )
  }
  const tab = fromRange ?? fromTab ?? tabs[0]
  if (tab === undefined) throw new ToolError("invalid_argument", "The spreadsheet has no tab to snapshot.")
  return tab
}

function requireDownloadDir(ctx: ToolContext): string {
  const { downloadDir } = ctx
  if (!downloadDir || !isAbsolute(downloadDir)) {
    throw new ToolError("internal_error", "Sheets snapshots require an absolute download directory.")
  }
  return downloadDir
}

/** The note for a render that filled the page limit, which says more pages may exist. */
function pageLimitNote(pages: number): string {
  const more = pages < MAX_SNAPSHOT_PAGES ? `; \`pages\` goes up to ${MAX_SNAPSHOT_PAGES}` : ""
  return `Rendered the first ${pages} ${pages === 1 ? "page" : "pages"}; the PDF may hold more pages${more}.`
}

/**
 * Exports a tab, or a closed block of it, as a PDF through Google's export
 * URL, saves it under the download directory and renders its first pages to
 * PNG when a renderer is installed. A bad `range`, or `range` and `tab`
 * naming different tabs, is `invalid_argument`. The PDF is removed when the
 * export fails or is stopped; the images are never the content, only paths.
 */
export async function snapshotSpreadsheet(
  client: GoogleClient,
  runtime: ToolRuntime,
  ctx: ToolContext,
  id: string,
  args: SnapshotArgs,
): Promise<SnapshotResult> {
  const range = args.range === undefined ? undefined : parsedRange(args.range)
  const downloadDir = requireDownloadDir(ctx)
  const pages = args.pages ?? DEFAULT_SNAPSHOT_PAGES
  const { title, tabs } = await readTabs(client, id)
  const tab = chosenTab(tabs, args, range?.tab)

  const query: Record<string, QueryValue> = {
    format: "pdf",
    gid: tab.sheetId,
    size: args.paper ?? "a4",
    portrait: args.portrait ?? false,
    scale: FIT_SCALES[args.fit ?? "width"],
    gridlines: args.gridlines ?? true,
    fzr: true,
    sheetnames: false,
    printtitle: false,
    pagenum: NO_PAGE_NUMBER,
    attachment: false,
    ...(range && {
      r1: range.block.startRowIndex,
      c1: range.block.startColumnIndex,
      r2: range.block.endRowIndex,
      c2: range.block.endColumnIndex,
    }),
  }

  const { path, handle } = await reserveDownload({
    downloadDir,
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    subdir: SNAPSHOT_SUBDIR,
    stem: `${title || id}-${tab.title}`,
    extension: "pdf",
    now: runtime.now(),
  })
  try {
    try {
      await client.download(SHEETS_ROUTES.export, {
        params: { spreadsheet_id: id },
        query,
        maxBytes: MAX_EXPORT_BYTES,
        timeoutMs: EXPORT_TIMEOUT_MS,
        accept: "application/pdf",
        write: (chunk) => handle.writeFile(chunk),
      })
    } finally {
      await handle.close()
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => {})
    throw error
  }

  const rendered = await renderPages({ pdf: path, pages, env: runtime.env, signal: ctx.signal })
  return {
    spreadsheet_id: id,
    tab: tab.title,
    range: args.range ?? null,
    pdf: path,
    pages: rendered.images,
    note: rendered.note ?? (rendered.images.length === pages ? pageLimitNote(pages) : null),
  }
}
