import { z } from "zod"
import { abortError } from "../exec"
import { googleSession, type GoogleSession } from "../google/session"
import { defineTool, type CallDescription, type ToolContext } from "../tool"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { SHEETS_TOOLSET } from "./scopes"
import { MAX_SPREADSHEET_TITLE_LENGTH, MAX_TAB_TITLE_LENGTH, accountArg } from "./schemas"
import { resolveSpreadsheetTargets } from "./targets"
import { SHEETS_WORDS } from "./words"

const MAX_TABS = 50

/** What stands in for the id of a spreadsheet that does not exist yet, in the call's target. */
const NEW_SPREADSHEET = "new"

const CREATE_FIELDS = "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index)"

export const sheetsCreateInput = z.strictObject({
  account: accountArg,
  title: z.string().min(1).max(MAX_SPREADSHEET_TITLE_LENGTH).describe("The new spreadsheet's title."),
  tabs: z
    .array(z.string().trim().min(1).max(MAX_TAB_TITLE_LENGTH))
    .min(1)
    .max(MAX_TABS)
    .refine((tabs) => new Set(tabs.map((tab) => tab.toLowerCase())).size === tabs.length, {
      error: "tab titles must be distinct, ignoring case.",
    })
    .optional()
    .describe("The titles of the tabs to start with, in order. Left out, Google adds one tab, `Sheet1`."),
})

export const sheetsCreateOutput = z.object({
  spreadsheet_id: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  tabs: z.array(z.object({ sheet_id: z.number().int(), title: z.string(), index: z.number().int() })),
})

type CreateArgs = z.output<typeof sheetsCreateInput>

const createReply = z.object({
  spreadsheetId: z.string(),
  spreadsheetUrl: z.string().optional(),
  properties: z.object({ title: z.string().optional() }).optional(),
  sheets: z
    .array(
      z.object({
        properties: z
          .object({ sheetId: z.number().optional(), title: z.string().optional(), index: z.number().optional() })
          .optional(),
      }),
    )
    .optional(),
})

/** The session the call creates with: the label it picked, checked to hold the write scope, before any request. */
async function planCreate(args: CreateArgs, ctx: ToolContext): Promise<GoogleSession> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const session = await googleSession(ctx, args.account, "Sheets writes")
  await session.client.requireScopes(SHEETS_ROUTES.create)
  return session
}

async function describeCreate(args: CreateArgs, ctx: ToolContext): Promise<CallDescription> {
  await planCreate(args, ctx)
  return {
    headline: { text: SHEETS_WORDS.createOne, values: { title: args.title } },
    facts: args.tabs === undefined ? [] : [{ label: SHEETS_WORDS.tabs, value: args.tabs.join(", ") }],
  }
}

async function createSpreadsheet(args: CreateArgs, ctx: ToolContext) {
  const { client } = await planCreate(args, ctx)
  const reply = parseReply(
    createReply,
    await client.request(SHEETS_ROUTES.create, {
      query: { fields: CREATE_FIELDS },
      body: {
        properties: { title: args.title },
        ...(args.tabs && { sheets: args.tabs.map((title) => ({ properties: { title } })) }),
      },
    }),
    "the creation",
  )
  return {
    spreadsheet_id: reply.spreadsheetId,
    title: reply.properties?.title ?? args.title,
    url: reply.spreadsheetUrl ?? null,
    tabs: (reply.sheets ?? []).map((sheet) => ({
      sheet_id: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
      index: sheet.properties?.index ?? 0,
    })),
  }
}

export const googleSheetsCreate = defineTool({
  id: "google_sheets_create",
  title: "Create a Google spreadsheet",
  intent: "About to create a spreadsheet",
  description:
    "Create a new Google spreadsheet in the account's Drive root, owned by the account, with the given `title` and, when `tabs` is given, those tabs in order (otherwise Google adds one tab, `Sheet1`). The result gives the new spreadsheet's id, its URL and its tabs. " +
    "The new spreadsheet is visible only to the account until it is shared. It is not idempotent: calling it twice creates two spreadsheets. Use google_sheets_tab_add to add a tab to an existing spreadsheet and google_sheets_append or google_sheets_edit to fill it. " +
    "`account` is needed when several accounts are set up.",
  toolset: SHEETS_TOOLSET,
  class: "add",
  input: sheetsCreateInput,
  output: sheetsCreateOutput,
  bounds: { tabs: { kind: "max", description: "The most tabs the call creates the spreadsheet with." } },
  measure: (args) => ({ tabs: args.tabs?.length ?? 0 }),
  targets: (args, ctx) =>
    resolveSpreadsheetTargets(ctx, async () => ({ label: (await planCreate(args, ctx)).label, id: NEW_SPREADSHEET })),
  describe: describeCreate,
  execute: createSpreadsheet,
})
