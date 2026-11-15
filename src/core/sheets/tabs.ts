import { z } from "zod"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { splitRange, type GridBounds } from "./a1"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { spreadsheetId } from "./spreadsheet-id"

const TABS_FIELDS = "properties(title),sheets(properties(sheetId,title,index)"
const TABLES_FIELDS = ",tables(tableId,name,range)"

/** How many tab or table names an error lists. */
const MAX_LISTED_NAMES = 20

/** How much of a refused range an error repeats. */
const MAX_SHOWN_LENGTH = 100

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const spreadsheetReply = z.object({
  properties: z.object({ title: z.string().optional() }).optional(),
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: gridNumber, title: z.string().optional(), index: gridNumber }).optional(),
        tables: z
          .array(
            z.object({
              tableId: z.string().optional(),
              name: z.string().optional(),
              range: z
                .object({
                  startRowIndex: gridNumber,
                  endRowIndex: gridNumber,
                  startColumnIndex: gridNumber,
                  endColumnIndex: gridNumber,
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

/** A native table of a tab, with the grid it covers. */
export type SheetTable = { tableId: string; name: string; range: GridBounds }

/** A tab as the writes need it: its id, title and position, and its tables when they were asked for. */
export type SheetTab = { sheetId: number; title: string; index: number; tables: SheetTable[] }

/** A spreadsheet's title and its tabs, in the order of their positions. */
export type SpreadsheetTabs = { title: string; tabs: SheetTab[] }

/** What a write works with: the client for the label it picked, that label, the spreadsheet's id and its tabs. */
export type OpenSpreadsheet = { client: GoogleClient; label: string; id: string } & SpreadsheetTabs

/** The spreadsheet's title and tabs (with their tables when `tables` is set), as Google reports them now. */
export async function readTabs(client: GoogleClient, id: string, tables = false): Promise<SpreadsheetTabs> {
  const reply = parseReply(
    spreadsheetReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: `${TABS_FIELDS}${tables ? TABLES_FIELDS : ""})` },
    }),
    "the spreadsheet",
  )
  const tabs = (reply.sheets ?? []).map((sheet): SheetTab => {
    const properties = sheet.properties ?? {}
    return {
      sheetId: properties.sheetId ?? 0,
      title: properties.title ?? "",
      index: properties.index ?? 0,
      tables: (sheet.tables ?? []).map((table) => ({
        tableId: table.tableId ?? "",
        name: table.name ?? "",
        range: table.range ?? {},
      })),
    }
  })
  return { title: reply.properties?.title ?? "", tabs: tabs.sort((a, b) => a.index - b.index) }
}

/**
 * Picks the label the call's `account` names, checks the spreadsheet's id and
 * that the label may call the `write` route, then reads the tabs, so a write
 * plans on what Google reports and a label that cannot write fails before any
 * call. A cancelled call stops before any of it.
 */
export async function openSpreadsheet(
  args: { account?: string; spreadsheet: string },
  ctx: ToolContext,
  write: Route,
  tables = false,
): Promise<OpenSpreadsheet> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const id = spreadsheetId(args.spreadsheet)
  const { client, label } = await googleSession(ctx, args.account, "Sheets writes")
  await client.requireScopes(write)
  return { client, label, id, ...(await readTabs(client, id, tables)) }
}

/** The names, up to `MAX_LISTED_NAMES`, as a sentence part: `a, b, c` and how many more, or `none`. */
export function listNames(names: readonly string[]): string {
  if (names.length === 0) return "none"
  const shown = names.slice(0, MAX_LISTED_NAMES).join(", ")
  return names.length > MAX_LISTED_NAMES ? `${shown} (+${names.length - MAX_LISTED_NAMES} more)` : shown
}

/**
 * The tab an A1 range writes to: the one its title names (exactly, else
 * ignoring case when that leaves one), and the first tab for cells with no tab.
 * A range that is not A1 notation, or names a tab the spreadsheet lacks, is
 * `invalid_argument`.
 */
export function tabOfRange(tabs: readonly SheetTab[], range: string): SheetTab {
  const shown = range.length > MAX_SHOWN_LENGTH ? `${range.slice(0, MAX_SHOWN_LENGTH)}…` : range
  const parts = splitRange(range)
  if (parts === undefined) {
    throw new ToolError("invalid_argument", `${JSON.stringify(shown)} is not a range in A1 notation.`)
  }
  const title = parts.tab
  const found =
    title === undefined
      ? tabs[0]
      : (tabs.find((tab) => tab.title === title) ??
        onlyOne(tabs.filter((tab) => tab.title.toLowerCase() === title.toLowerCase())))
  if (found === undefined) {
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(shown)} names no tab of the spreadsheet; its tabs are: ${listNames(tabs.map((tab) => tab.title))}.`,
    )
  }
  return found
}

function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined
}
