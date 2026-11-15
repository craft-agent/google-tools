import { z } from "zod"
import { defineTool, type CallDescription, type ToolContext } from "../tool"
import { ADD_OPERATION_NAMES, ADD_OPERATIONS, addOperationSchema } from "./add-operations"
import { MAX_OPERATION_RANGES, rangesIn } from "./operation-ranges"
import { planOperations } from "./operations"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { SHEETS_TOOLSET } from "./scopes"
import { accountArg, spreadsheetArg } from "./schemas"
import { resolveSheetTargets } from "./targets"
import { operationsFact, rangesFact, tabsFact } from "./write-describe"
import { SHEETS_WORDS } from "./words"

/** The most operations one call carries. */
const MAX_ADD_OPERATIONS = 100

export const sheetsAddInput = z
  .strictObject({
    account: accountArg,
    spreadsheet: spreadsheetArg,
    operations: z
      .array(addOperationSchema)
      .min(1)
      .max(MAX_ADD_OPERATIONS)
      .describe(
        `1 to ${MAX_ADD_OPERATIONS} operations, each an object with an \`op\` (${ADD_OPERATION_NAMES}) and that operation's arguments; they apply in order, and all of them land or none does.`,
      ),
  })
  .refine((args) => rangesIn(args.operations) <= MAX_OPERATION_RANGES, {
    message: `The operations name more than ${MAX_OPERATION_RANGES} ranges in all; split the call.`,
    path: ["operations"],
  })

export const sheetsAddOutput = z.object({
  spreadsheet_id: z.string(),
  applied: z
    .array(z.string())
    .describe("One line per operation, in order, with its ranges as Google resolves them: what was applied."),
  requests: z.number().int().describe("How many requests the operations made up in the one batch."),
  tabs: z.array(z.string()).describe("The titles of the existing tabs that were changed, left to right."),
  created: z
    .array(z.object({ sheet_id: z.number().int(), title: z.string(), index: z.number().int() }))
    .describe("The tabs the call created, in the order of the operations that made them, as Google answered."),
})

type AddArgs = z.output<typeof sheetsAddInput>

const batchReply = z.object({
  replies: z
    .array(
      z.object({
        duplicateSheet: z
          .object({
            properties: z
              .object({ sheetId: z.number().optional(), title: z.string().optional(), index: z.number().optional() })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
})

/** The spreadsheet and the requests every operation makes up. Describing, targeting and running all plan with this. */
function planAdd(args: AddArgs, ctx: ToolContext) {
  return planOperations(ADD_OPERATIONS, args, ctx, SHEETS_ROUTES.batchUpdate)
}

async function describeAdd(args: AddArgs, ctx: ToolContext): Promise<CallDescription> {
  const plan = await planAdd(args, ctx)
  const [only] = plan.written
  return {
    headline:
      plan.written.length === 1 && only !== undefined && !plan.onSpreadsheet
        ? { text: SHEETS_WORDS.addTab, values: { tab: only.title, spreadsheet: plan.title } }
        : { text: SHEETS_WORDS.addSpreadsheet, values: { spreadsheet: plan.title } },
    facts: [tabsFact(plan.written), operationsFact(args.operations.length), rangesFact(rangesIn(args.operations))],
    text: { label: SHEETS_WORDS.operations, body: plan.lines.join("\n") },
  }
}

async function addToSpreadsheet(args: AddArgs, ctx: ToolContext) {
  const plan = await planAdd(args, ctx)
  const reply = parseReply(
    batchReply,
    await plan.client.request(SHEETS_ROUTES.batchUpdate, {
      params: { spreadsheet_id: plan.id },
      body: { requests: plan.requests, includeSpreadsheetInResponse: false },
    }),
    "the additions",
  )
  const created = plan.requests.flatMap((request, position) =>
    "duplicateSheet" in request ? [reply.replies?.[position]?.duplicateSheet?.properties] : [],
  )
  return {
    spreadsheet_id: plan.id,
    applied: plan.lines,
    requests: plan.requests.length,
    tabs: plan.written.map((tab) => tab.title),
    created: created.map((properties) => ({
      sheet_id: properties?.sheetId ?? 0,
      title: properties?.title ?? "",
      index: properties?.index ?? 0,
    })),
  }
}

export const googleSheetsAdd = defineTool({
  id: "google_sheets_add",
  title: "Add rows and tabs to a Google spreadsheet",
  intent: "About to add to a spreadsheet",
  description:
    `Add rows, columns and tabs to a Google spreadsheet, by \`spreadsheet\` (its id or URL): 1 to ${MAX_ADD_OPERATIONS} \`operations\` that apply in order as one batch, so all of them land or none does. ` +
    "It never removes or overwrites a cell, but it is not idempotent: applying the same operations again adds again. " +
    "Each operation is an object with `op` and its arguments. " +
    "`insert` takes a `range` of whole rows (`Plan!5:7`) or whole columns (`Plan!C:D`) and inserts as many empty ones as it spans before them, so the rows or columns named and everything after them shift down or right, and a later operation's range means the cells as they stand by then; `inherit` (`before` by default, or `after`) says whose formatting the new ones take, and the first row or column has none before it. " +
    "`tab_duplicate` copies the `tab` as a new tab, with an optional `title` (no tab may have it already, ignoring case) and `position` counted from 0 (left out, right after the original); the result's `created` lists each new tab's `sheet_id`, `title` and `index`. " +
    "Any other operation is refused. Use google_sheets_tab_add for an empty tab, google_sheets_format for formatting and google_sheets_restructure to delete, move or merge. " +
    `A call names at most ${MAX_OPERATION_RANGES} ranges in all. ` +
    "`account` is needed when several accounts are set up.",
  toolset: SHEETS_TOOLSET,
  class: "add",
  input: sheetsAddInput,
  output: sheetsAddOutput,
  bounds: {
    operations: { kind: "max", description: "The most operations the call carries." },
    ranges: { kind: "max", description: "The most ranges the call names." },
  },
  measure: (args) => ({ operations: args.operations.length, ranges: rangesIn(args.operations) }),
  targets: (args, ctx) => resolveSheetTargets(ctx, () => planAdd(args, ctx)),
  describe: describeAdd,
  execute: addToSpreadsheet,
})
