import { z } from "zod"
import { defineTool, type CallDescription, type ToolContext } from "../tool"
import { FORMAT_OPERATION_NAMES, FORMAT_OPERATIONS, formatOperationSchema } from "./format-operations"
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
const MAX_FORMAT_OPERATIONS = 100

export const sheetsFormatInput = z
  .strictObject({
    account: accountArg,
    spreadsheet: spreadsheetArg,
    operations: z
      .array(formatOperationSchema)
      .min(1)
      .max(MAX_FORMAT_OPERATIONS)
      .describe(
        `1 to ${MAX_FORMAT_OPERATIONS} operations, each an object with an \`op\` (${FORMAT_OPERATION_NAMES}) and that operation's arguments; they apply in order, and all of them land or none does.`,
      ),
  })
  .refine((args) => rangesIn(args.operations) <= MAX_OPERATION_RANGES, {
    message: `The operations name more than ${MAX_OPERATION_RANGES} ranges in all; split the call.`,
    path: ["operations"],
  })

export const sheetsFormatOutput = z.object({
  spreadsheet_id: z.string(),
  applied: z
    .array(z.string())
    .describe("One line per operation, in order, with its ranges as Google resolves them: what was applied."),
  requests: z.number().int().describe("How many requests the operations made up in the one batch."),
  tabs: z.array(z.string()).describe("The titles of the tabs that were changed, left to right."),
})

type FormatArgs = z.output<typeof sheetsFormatInput>

const batchReply = z.object({ replies: z.array(z.unknown()).optional() })

/** The spreadsheet and the requests every operation makes up. Describing, targeting and running all plan with this. */
function planFormat(args: FormatArgs, ctx: ToolContext) {
  return planOperations(FORMAT_OPERATIONS, args, ctx, SHEETS_ROUTES.batchUpdate)
}

async function describeFormat(args: FormatArgs, ctx: ToolContext): Promise<CallDescription> {
  const plan = await planFormat(args, ctx)
  const [only] = plan.written
  return {
    headline:
      plan.written.length === 1 && only !== undefined
        ? { text: SHEETS_WORDS.formatTab, values: { tab: only.title, spreadsheet: plan.title } }
        : { text: SHEETS_WORDS.formatSpreadsheet, values: { spreadsheet: plan.title } },
    facts: [tabsFact(plan.written), operationsFact(args.operations.length), rangesFact(rangesIn(args.operations))],
    text: { label: SHEETS_WORDS.operations, body: plan.lines.join("\n") },
  }
}

async function formatSpreadsheet(args: FormatArgs, ctx: ToolContext) {
  const plan = await planFormat(args, ctx)
  parseReply(
    batchReply,
    await plan.client.request(SHEETS_ROUTES.batchUpdate, {
      params: { spreadsheet_id: plan.id },
      body: { requests: plan.requests, includeSpreadsheetInResponse: false },
    }),
    "the formatting",
  )
  return {
    spreadsheet_id: plan.id,
    applied: plan.lines,
    requests: plan.requests.length,
    tabs: plan.written.map((tab) => tab.title),
  }
}

export const googleSheetsFormat = defineTool({
  id: "google_sheets_format",
  title: "Format a Google spreadsheet",
  intent: "About to format a spreadsheet",
  description:
    `Format a Google spreadsheet's cells, rows, columns and tabs, by \`spreadsheet\` (its id or URL): 1 to ${MAX_FORMAT_OPERATIONS} \`operations\` that apply in order as one batch, so all of them land or none does. ` +
    "It never changes a cell's value and never removes anything; applying the same operations again leaves the same result. " +
    "Each operation is an object with `op` and its arguments, and the ranges of an operation are A1 notation in `range` or `ranges` (a block, whole rows `3:5`, whole columns `B:D`, or a tab's name for all of it). " +
    "`format` sets only the properties given on cells (`bold`, `italic`, `underline`, `strikethrough`, `font`, `font_size`, `color`, `background` as `#rrggbb` or `null` to clear, `horizontal_align`, `vertical_align`, `wrap`, `number_format` as `{ type, pattern }`, `rotation`, `padding`), and `reset: true` clears every format first. " +
    "`borders` draws `sides` (`top`, `bottom`, `left`, `right`, `inner_horizontal`, `inner_vertical`, `all`, `outer`, `inner`, or `none` to remove them) with a `style` and `color`. " +
    "`size` sets the `pixels` of whole rows or columns, or fits them to their contents with `auto: true`; `hide` and `unhide` act on whole rows or columns; `group` (optionally `collapsed`) and `ungroup` do the same for outline groups, where a span that already is a group is not grouped again and a span that is not a group cannot be ungrouped; `unmerge` splits merged cells. " +
    "`freeze` sets how many `rows` and `columns` of a `tab` stay in view; `tab` sets a tab's `color`, `hidden`, `position` (from 0) and `gridlines`, never its title. " +
    "Any other operation is refused. Read the current formatting with google_sheets_read method `format`. " +
    `A call names at most ${MAX_OPERATION_RANGES} ranges in all. It is asked about every time. ` +
    "`account` is needed when several accounts are set up.",
  toolset: SHEETS_TOOLSET,
  class: "idempotent",
  input: sheetsFormatInput,
  output: sheetsFormatOutput,
  bounds: {
    operations: { kind: "max", description: "The most operations the call carries." },
    ranges: { kind: "max", description: "The most ranges the call names." },
  },
  measure: (args) => ({ operations: args.operations.length, ranges: rangesIn(args.operations) }),
  targets: (args, ctx) => resolveSheetTargets(ctx, () => planFormat(args, ctx)),
  describe: describeFormat,
  execute: formatSpreadsheet,
})
