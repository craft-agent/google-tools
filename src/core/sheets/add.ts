import { z } from "zod"
import { defineTool, type CallDescription, type ToolContext } from "../tool"
import { gridRangeA1 } from "./a1"
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
  tables: z
    .array(z.object({ table_id: z.string(), name: z.string(), range: z.string() }))
    .describe("The tables the call made, in the order of the operations, as Google answered: id, name and range."),
  filter_views: z
    .array(z.object({ view_id: z.number().int(), title: z.string() }))
    .describe("The filter views the call made, in the order of the operations, as Google answered."),
  charts: z
    .array(z.object({ chart_id: z.number().int(), title: z.string().nullable() }))
    .describe("The charts the call made, in the order of the operations, as Google answered: id and title."),
})

type AddArgs = z.output<typeof sheetsAddInput>

const createdTabReply = z
  .object({
    properties: z
      .object({ sheetId: z.number().optional(), title: z.string().optional(), index: z.number().optional() })
      .optional(),
  })
  .optional()

const batchReply = z.object({
  replies: z
    .array(
      z.object({
        duplicateSheet: createdTabReply,
        addSheet: createdTabReply,
        addChart: z
          .object({
            chart: z
              .object({ chartId: z.number().optional(), spec: z.object({ title: z.string().optional() }).optional() })
              .optional(),
          })
          .optional(),
        addTable: z
          .object({
            table: z
              .object({
                tableId: z.string().optional(),
                name: z.string().optional(),
                range: z
                  .object({
                    sheetId: z.number().optional(),
                    startRowIndex: z.number().optional(),
                    endRowIndex: z.number().optional(),
                    startColumnIndex: z.number().optional(),
                    endColumnIndex: z.number().optional(),
                  })
                  .optional(),
              })
              .optional(),
          })
          .optional(),
        addFilterView: z
          .object({
            filter: z.object({ filterViewId: z.number().optional(), title: z.string().optional() }).optional(),
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
    "duplicateSheet" in request
      ? [reply.replies?.[position]?.duplicateSheet?.properties]
      : "addSheet" in request
        ? [reply.replies?.[position]?.addSheet?.properties]
        : [],
  )
  const charts = plan.requests.flatMap((request, position) =>
    "addChart" in request ? [reply.replies?.[position]?.addChart?.chart] : [],
  )
  const tables = plan.requests.flatMap((request, position) =>
    "addTable" in request ? [reply.replies?.[position]?.addTable?.table] : [],
  )
  const views = plan.requests.flatMap((request, position) =>
    "addFilterView" in request ? [reply.replies?.[position]?.addFilterView?.filter] : [],
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
    tables: tables.map((table) => ({
      table_id: table?.tableId ?? "",
      name: table?.name ?? "",
      range: gridRangeA1(
        plan.tabs.find((tab) => tab.sheetId === (table?.range?.sheetId ?? 0))?.title ?? "",
        table?.range,
      ),
    })),
    filter_views: views.map((view) => ({ view_id: view?.filterViewId ?? 0, title: view?.title ?? "" })),
    charts: charts.map((chart) => ({ chart_id: chart?.chartId ?? 0, title: chart?.spec?.title ?? null })),
  }
}

export const googleSheetsAdd = defineTool({
  id: "google_sheets_add",
  title: "Add rows and tabs to a Google spreadsheet",
  intent: "About to add to a spreadsheet",
  description:
    `Add rows, columns, tabs, tables, conditional rules, data validation, filters, charts and pivot tables to a Google spreadsheet, by \`spreadsheet\` (its id or URL): 1 to ${MAX_ADD_OPERATIONS} \`operations\` that apply in order as one batch, so all of them land or none does. ` +
    "It never removes or overwrites a cell or an object a person made, but it is not idempotent: applying the same operations again adds again. " +
    "Each operation is an object with `op` and its arguments. " +
    "`insert` takes a `range` of whole rows (`Plan!5:7`) or whole columns (`Plan!C:D`) and inserts as many empty ones as it spans before them, so the rows or columns named and everything after them shift down or right, and a later operation's range means the cells as they stand by then; `inherit` (`before` by default, or `after`) says whose formatting the new ones take, and the first row or column has none before it. " +
    "`tab_duplicate` copies the `tab` as a new tab, with an optional `title` (no tab may have it already, ignoring case) and `position` counted from 0 (left out, right after the original); the result's `created` lists each new tab's `sheet_id`, `title` and `index`. " +
    "`table` makes a native table of `range`, a closed block with its header row, that overlaps no table; `name` (default `Table1`, `Table2`…), `table_columns` (`{ column, type?, name?, values? }`: Google's column type, such as `DOUBLE` or `DROPDOWN` with its options in `values`), `header_color`, `band_colors` (one or two) and `footer_color` are optional, and a column new to the table that is not named keeps its header cell's text as its name; the result's `tables` lists each new table's `table_id`, `name` and `range`. " +
    "`conditional` adds a conditional formatting rule over `range` or `ranges` of one tab, as the tab's first rule (the numbers of the others go up by one): either `when` (Google's condition type, such as `NUMBER_GREATER`) with its `values` and at least one style of `bold`, `italic`, `strikethrough`, `color` and `background`, or `scale`, two or three colors from the lowest value up. " +
    "`validate` sets a data validation rule over `range` or `ranges` that have none: `when` (such as `ONE_OF_LIST`, whose options are `values`, or `NUMBER_BETWEEN`), `values`, `strict` (default true: reject other input, false: warn), `dropdown` (default true) and `help`; a range that has validation already is refused (google_sheets_restructure's `validate_replace` replaces it), and so is a range of more than 10,000 cells, which cannot be checked. " +
    "`filter` sets the `range`'s tab's basic filter with optional `filter_columns` (`{ column, hide?, when?, values? }`: values to hide, or a condition to show by) on a tab that has none (google_sheets_restructure's `filter_replace` replaces it). " +
    "`filter_view` adds a filter view `name` over `range` with optional `filter_columns`; the result's `filter_views` lists each new view's `view_id` and `title`. " +
    "`chart` adds a chart of `range`, a block or whole columns (`Sales!A1:C13`, `Sales!A:C`): its first column labels the rows, each other column is a series, and its first row is the header unless `header` is false; a `pie` chart takes two columns. `chart_type` (`column` by default, `bar`, `line`, `area`, `scatter`, `combo` or `pie`), `title`, `legend` (`bottom` by default, `top`, `left`, `right` or `none`), `stacked` (`bar`, `column`, `area` and `combo` charts), `width` and `height` in pixels are optional, and the chart sits beside the data unless `at` (the cell its top-left corner is on) or `new_tab: true` (a tab of its own) says otherwise; the result's `charts` lists each new chart's `chart_id` and `title`. " +
    "`pivot` adds a pivot table of the source `range` (a block or whole columns with its header row): `pivot_rows` and `pivot_columns` (each a column letter, or `{ column, group?, sort?, label?, totals? }` to group dates by a part such as `YEAR_MONTH`, sort `desc`, set a heading or hide the totals), `pivot_values` (at least one `{ column, summarize?, name? }`, or `{ formula, summarize?, name? }` with a formula such as `=SUM(Amount)` that names the source's columns by their header) and `pivot_filters` (`{ column, show }`, the values to keep), placed at the cell `at` or on a new tab with `new_tab: true` and an optional `title` (the result's `created` lists it). A pivot table's size is unknown until Google computes it, so one placed at `at` is refused when any cell from there to the tab's last row and column holds a value or a pivot table, and when that is more than 10,000 cells, which cannot be checked. " +
    "Any other operation is refused. Use google_sheets_tab_add for an empty tab, google_sheets_format for formatting and google_sheets_restructure to delete, move or merge, and to change or remove tables, rules, validation, filters, charts and pivot tables. " +
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
