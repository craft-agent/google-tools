import { z } from "zod"
import { ToolError } from "../errors"
import { defineTool, type CallDescription, type CallFact, type ToolContext } from "../tool"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { SHEETS_TOOLSET } from "./scopes"
import { accountArg, spreadsheetArg } from "./schemas"
import { openSpreadsheet, type OpenSpreadsheet } from "./tabs"
import { resolveSpreadsheetTargets } from "./targets"
import { SHEETS_WORDS } from "./words"

const MAX_TITLE_LENGTH = 100
const MAX_ROWS = 100000
const MAX_COLUMNS = 18278

/** The size Google gives a new tab when a dimension is left out. */
const DEFAULT_ROWS = 1000
const DEFAULT_COLUMNS = 26

export const sheetsTabAddInput = z.strictObject({
  account: accountArg,
  spreadsheet: spreadsheetArg,
  title: z.string().min(1).max(MAX_TITLE_LENGTH).describe("The new tab's title; no tab may have it already."),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("The new tab's position, counted from 0. Left out, it goes after the last tab."),
  rows: z
    .number()
    .int()
    .min(1)
    .max(MAX_ROWS)
    .optional()
    .describe(`How many rows the tab starts with (1 to ${MAX_ROWS}). Left out, Google's default.`),
  columns: z
    .number()
    .int()
    .min(1)
    .max(MAX_COLUMNS)
    .optional()
    .describe(`How many columns the tab starts with (1 to ${MAX_COLUMNS}). Left out, Google's default.`),
})

export const sheetsTabAddOutput = z.object({
  spreadsheet_id: z.string(),
  tab: z.object({
    sheet_id: z.number().int(),
    title: z.string(),
    index: z.number().int(),
    row_count: z.number().int(),
    column_count: z.number().int(),
  }),
})

type TabAddArgs = z.output<typeof sheetsTabAddInput>

const tabAddReply = z.object({
  replies: z
    .array(
      z.object({
        addSheet: z
          .object({
            properties: z
              .object({
                sheetId: z.number().optional(),
                title: z.string().optional(),
                index: z.number().optional(),
                gridProperties: z
                  .object({ rowCount: z.number().optional(), columnCount: z.number().optional() })
                  .optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
})

/** The spreadsheet as Google reports it now, once the title is known to be free. Describing, targeting and running all plan with this. */
async function planTabAdd(args: TabAddArgs, ctx: ToolContext): Promise<OpenSpreadsheet> {
  const open = await openSpreadsheet(args, ctx, SHEETS_ROUTES.batchUpdate)
  const taken = open.tabs.find((tab) => tab.title.toLowerCase() === args.title.toLowerCase())
  if (taken !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `The spreadsheet already has a tab titled ${JSON.stringify(taken.title)}; a tab's title must be new, ignoring case.`,
    )
  }
  return open
}

async function describeTabAdd(args: TabAddArgs, ctx: ToolContext): Promise<CallDescription> {
  const plan = await planTabAdd(args, ctx)
  const facts: CallFact[] = []
  if (args.index !== undefined) facts.push({ label: SHEETS_WORDS.position, value: String(args.index) })
  if (args.rows !== undefined || args.columns !== undefined) {
    facts.push({
      label: SHEETS_WORDS.size,
      value: {
        text: SHEETS_WORDS.sizeValue,
        values: { rows: args.rows ?? DEFAULT_ROWS, columns: args.columns ?? DEFAULT_COLUMNS },
      },
    })
  }
  return {
    headline: { text: SHEETS_WORDS.tabAddOne, values: { tab: args.title, spreadsheet: plan.title } },
    facts,
  }
}

async function addTab(args: TabAddArgs, ctx: ToolContext) {
  const plan = await planTabAdd(args, ctx)
  const grid = {
    ...(args.rows !== undefined && { rowCount: args.rows }),
    ...(args.columns !== undefined && { columnCount: args.columns }),
  }
  const reply = parseReply(
    tabAddReply,
    await plan.client.request(SHEETS_ROUTES.batchUpdate, {
      params: { spreadsheet_id: plan.id },
      body: {
        requests: [
          {
            addSheet: {
              properties: {
                title: args.title,
                ...(args.index !== undefined && { index: args.index }),
                ...(Object.keys(grid).length > 0 && { gridProperties: grid }),
              },
            },
          },
        ],
      },
    }),
    "adding the tab",
  )
  const properties = reply.replies[0]!.addSheet?.properties
  return {
    spreadsheet_id: plan.id,
    tab: {
      sheet_id: properties?.sheetId ?? 0,
      title: properties?.title ?? args.title,
      index: properties?.index ?? 0,
      row_count: properties?.gridProperties?.rowCount ?? 0,
      column_count: properties?.gridProperties?.columnCount ?? 0,
    },
  }
}

export const googleSheetsTabAdd = defineTool({
  id: "google_sheets_tab_add",
  title: "Add a tab to a Google spreadsheet",
  intent: "About to add a tab to a spreadsheet",
  description:
    "Add a new tab (sheet) to an existing Google spreadsheet, by `spreadsheet` (its id or URL). `title` must not be used by another tab of the spreadsheet, ignoring case, or the call is refused before it writes. " +
    "`index` is the tab's position counted from 0 (left out, it goes last); `rows` and `columns` set its size (left out, Google's default). The result gives the new tab's id, title, position and size. " +
    "It is not idempotent: a second call with the same title is refused. Use google_sheets_create for a new spreadsheet and google_sheets_append or google_sheets_edit to fill the tab. " +
    "`account` is needed when several accounts are set up.",
  toolset: SHEETS_TOOLSET,
  class: "add",
  input: sheetsTabAddInput,
  output: sheetsTabAddOutput,
  bounds: {},
  targets: (args, ctx) => resolveSpreadsheetTargets(ctx, () => planTabAdd(args, ctx)),
  describe: describeTabAdd,
  execute: addTab,
})
