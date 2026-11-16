import { z } from "zod"
import { ToolError } from "../errors"
import { fewValues, listValues, plainValues } from "./conditions"
import { columnIndex, resolveRange, type ResolvedRange } from "./grid"
import { defineOperation, type OperationContext } from "./operations"
import { singleCell, type ClosedArea } from "./operation-blocks"
import { areaLabel, areasOf, columnLetterArg, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"
import { requireFreeTitle } from "./operations.tab-lifecycle"
import { MAX_TAB_TITLE_LENGTH } from "./schemas"

/** The most rows, columns, values and filters a pivot table takes each. */
const MAX_PIVOT_ENTRIES = 20

const MAX_PIVOT_NAME_LENGTH = 100

/** What a new tab for a pivot table is called when it is given no title, followed by the first number no tab has taken. */
const DEFAULT_PIVOT_TITLE = "Pivot table"

/** The parts of a date that a row or a column of a pivot table may group the dates of a column by: Google's `DateTimeRuleType`. */
const DATE_GROUPS = [
  "YEAR",
  "YEAR_MONTH",
  "YEAR_QUARTER",
  "YEAR_MONTH_DAY",
  "QUARTER",
  "MONTH",
  "DAY_OF_MONTH",
  "DAY_OF_WEEK",
  "DAY_OF_YEAR",
  "DAY_MONTH",
  "HOUR",
  "HOUR_MINUTE",
  "HOUR_MINUTE_AMPM",
  "MINUTE",
  "SECOND",
] as const

/** How a pivot table summarizes a column, and the summary of a formula. */
const SUMMARIES = [
  "SUM",
  "COUNTA",
  "COUNT",
  "COUNTUNIQUE",
  "AVERAGE",
  "MAX",
  "MIN",
  "MEDIAN",
  "PRODUCT",
  "STDEV",
  "VAR",
] as const
const CUSTOM_SUMMARY = "CUSTOM"
const DEFAULT_SUMMARY = "SUM"

/** Google's name for each order a group may be sorted in. */
const SORT_ORDERS = { asc: "ASCENDING", desc: "DESCENDING" } as const

const pivotName = z.string().trim().min(1).max(MAX_PIVOT_NAME_LENGTH)

const pivotGroupSchema = z.union([
  columnLetterArg,
  z.strictObject({
    column: columnLetterArg,
    group: z.enum(DATE_GROUPS).optional().describe("Groups a column of dates by this part of the date."),
    sort: z.enum(["asc", "desc"]).optional().describe("`asc` (the default) or `desc`."),
    label: pivotName.optional().describe("The group's heading."),
    totals: z.boolean().optional().describe("Whether the group shows its totals (default true)."),
  }),
])

const pivotValueSchema = z.union([
  z.strictObject({
    column: columnLetterArg,
    summarize: z.enum(SUMMARIES).optional().describe(`How the column is summarized (default ${DEFAULT_SUMMARY}).`),
    name: pivotName.optional().describe("The value's heading."),
  }),
  z.strictObject({
    formula: z
      .string()
      .startsWith("=")
      .max(MAX_PIVOT_NAME_LENGTH * 10)
      .describe("A formula that names the source's columns by their header, such as `=SUM(Amount)`."),
    summarize: z
      .enum([...SUMMARIES, CUSTOM_SUMMARY])
      .optional()
      .describe(`How it is summarized (default ${CUSTOM_SUMMARY}).`),
    name: pivotName.optional().describe("The value's heading."),
  }),
])

const pivotFilterSchema = z.strictObject({
  column: columnLetterArg,
  show: listValues.describe("The values of the column to keep; every other value is hidden."),
})

const pivotSchema = z
  .strictObject({
    op: z.literal("pivot"),
    range: rangeText.describe("The source, a block or whole columns with its header row (`Plan!A1:D100`, `Plan!A:D`)."),
    pivot_rows: z
      .array(pivotGroupSchema)
      .max(MAX_PIVOT_ENTRIES)
      .optional()
      .describe("The rows, each a column letter or `{ column, group?, sort?, label?, totals? }`."),
    pivot_columns: z
      .array(pivotGroupSchema)
      .max(MAX_PIVOT_ENTRIES)
      .optional()
      .describe("The columns, each a column letter or `{ column, group?, sort?, label?, totals? }`."),
    pivot_values: z
      .array(pivotValueSchema)
      .min(1)
      .max(MAX_PIVOT_ENTRIES)
      .describe("The values, each `{ column, summarize?, name? }` or `{ formula, summarize?, name? }`."),
    pivot_filters: z
      .array(pivotFilterSchema)
      .max(MAX_PIVOT_ENTRIES)
      .optional()
      .describe("The filters, each `{ column, show }`."),
    at: rangeText
      .optional()
      .describe("The cell the pivot table's top-left corner goes on (`Report!A1`); no tab means the source's tab."),
    new_tab: z.literal(true).optional().describe("`true` puts the pivot table on a new tab of its own."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TAB_TITLE_LENGTH)
      .optional()
      .describe("The new tab's title, with `new_tab`; no tab may have it already, ignoring case."),
  })
  .refine((op) => (op.at === undefined) !== (op.new_tab === undefined), {
    message: "Give `at` or `new_tab`, one of them.",
  })
  .refine((op) => op.title === undefined || op.new_tab !== undefined, {
    message: "`title` names the new tab, so it goes with `new_tab`.",
  })

const pivotDeleteSchema = z.strictObject({
  op: z.literal("pivot_delete"),
  at: rangeText.describe("The pivot table's top-left cell (`Report!A1`), as the `structure` read lists it."),
})

type PivotOperation = z.output<typeof pivotSchema>
type PivotGroup = Exclude<z.output<typeof pivotGroupSchema>, string>

/** A row or column of the table as the object form of its entry. */
function groupOf(entry: z.output<typeof pivotGroupSchema>): PivotGroup {
  return typeof entry === "string" ? { column: entry } : entry
}

/** The block from the cell to the last row and column of its tab, which is as far as a pivot table placed there may reach. */
function toTabEnd({ tab, grid }: ClosedArea, { objects }: OperationContext): ResolvedRange {
  const size = objects.sizes.get(tab.sheetId)
  return {
    tab,
    grid: {
      ...grid,
      endRowIndex: Math.max(size?.rows ?? 0, grid.endRowIndex),
      endColumnIndex: Math.max(size?.columns ?? 0, grid.endColumnIndex),
    },
  }
}

/** The pivot table's request body; `offset` counts a column from the source's first column, refusing one outside the source. */
function pivotTable(op: PivotOperation, source: ResolvedRange, offset: (letters: string, what: string) => number) {
  const groups = (entries: readonly z.output<typeof pivotGroupSchema>[] | undefined, what: string) =>
    (entries ?? []).map(groupOf).map((entry) => ({
      sourceColumnOffset: offset(entry.column, what),
      showTotals: entry.totals ?? true,
      sortOrder: SORT_ORDERS[entry.sort ?? "asc"],
      ...(entry.group !== undefined && { groupRule: { dateTimeRule: { type: entry.group } } }),
      ...(entry.label !== undefined && { label: entry.label }),
    }))
  const rows = groups(op.pivot_rows, "pivot_rows")
  const columns = groups(op.pivot_columns, "pivot_columns")
  const values = op.pivot_values.map((entry) => ({
    ...("formula" in entry ? { formula: entry.formula } : { sourceColumnOffset: offset(entry.column, "pivot_values") }),
    summarizeFunction: entry.summarize ?? ("formula" in entry ? CUSTOM_SUMMARY : DEFAULT_SUMMARY),
    ...(entry.name !== undefined && { name: entry.name }),
  }))
  const filters = (op.pivot_filters ?? []).map((filter) => ({
    columnOffsetIndex: offset(filter.column, "pivot_filters"),
    filterCriteria: { visibleValues: plainValues(filter.show) },
  }))
  return {
    source: source.grid,
    valueLayout: "HORIZONTAL",
    ...(rows.length > 0 && { rows }),
    ...(columns.length > 0 && { columns }),
    values,
    ...(filters.length > 0 && { filterSpecs: filters }),
  }
}

/** The title of the tab a pivot table on a new tab goes on: the one given, else `Pivot table` and the first number no tab has taken. */
function newTabTitle(op: PivotOperation, context: OperationContext): string {
  if (op.title !== undefined) {
    requireFreeTitle(context, op.title)
    return op.title
  }
  const used = new Set(
    [...context.tabs.map((tab) => tab.title), ...context.created].map((title) => title.toLowerCase()),
  )
  let number = 1
  while (used.has(`${DEFAULT_PIVOT_TITLE} ${number}`.toLowerCase())) number++
  return `${DEFAULT_PIVOT_TITLE} ${number}`
}

/** The id a tab created in this call gets: above every id a tab has or an earlier operation gives. */
function newSheetId({ tabs, newIds }: OperationContext): number {
  return Math.max(0, ...tabs.map((tab) => tab.sheetId), ...newIds) + 1
}

/**
 * What `pivot` works out before it changes anything: the source, where the
 * table goes and the table itself. A table placed at a cell is refused when
 * the cells from there to the tab's last row and column hold a value or a
 * pivot table, as read right before the plan: its size is unknown until Google
 * computes it.
 */
function planPivot(op: PivotOperation, context: OperationContext) {
  const source = areasOf(op, context.tabs)[0]!
  const { startColumnIndex: first, endColumnIndex: end } = source.grid
  if (first === undefined || end === undefined) {
    throw new ToolError(
      "invalid_argument",
      "A pivot table's source is a block or whole columns with its header row, such as `Plan!A1:D100` or `Plan!A:D`.",
    )
  }
  const offset = (letters: string, what: string) => {
    const index = columnIndex(letters)
    if (index < first || index >= end) {
      throw new ToolError(
        "invalid_argument",
        `${what} column ${letters.toUpperCase()} is outside the source ${areaLabel(source)}.`,
      )
    }
    return index - first
  }
  const table = pivotTable(op, source, offset)
  const at = op.at === undefined ? undefined : singleCell(resolveOn(context.tabs, op.at, source.tab), "at")
  if (at !== undefined && (context.read.get(op)?.filled?.definitions.length ?? 0) > 0) {
    throw new ToolError(
      "invalid_argument",
      `A pivot table over filled cells would overwrite them: ${areaLabel(at)} to the end of its tab holds a value or a pivot table; place it on a new tab or an empty area.`,
    )
  }
  return { source, at, table }
}

/** What a line says of a table's rows or columns: their letters, with the date part and the order that sets them apart. */
function groupWords(label: string, entries: readonly z.output<typeof pivotGroupSchema>[] | undefined): string[] {
  const words = (entries ?? [])
    .map(groupOf)
    .map(
      (entry) =>
        entry.column.toUpperCase() +
        (entry.group === undefined ? "" : ` by ${entry.group.toLowerCase().replaceAll("_", " ")}`) +
        (entry.sort === "desc" ? " descending" : ""),
    )
  return words.length === 0 ? [] : [`${label} ${words.join(", ")}`]
}

/** `pivot`: adds a pivot table of a source range at a cell of an empty area, or on a new tab. */
export const pivotOperation = defineOperation({
  schema: pivotSchema,
  needs: ["objects"],
  onSpreadsheet: true,
  reads(op, context) {
    const { at } = planPivot(op, context)
    return at === undefined ? {} : { filled: [toTabEnd(at, context)] }
  },
  requests(op, context) {
    const { at, table } = planPivot(op, context)
    const update = (start: object) => ({
      updateCells: { start, fields: "pivotTable", rows: [{ values: [{ pivotTable: table }] }] },
    })
    if (at !== undefined) {
      return [
        update({ sheetId: at.grid.sheetId, rowIndex: at.grid.startRowIndex, columnIndex: at.grid.startColumnIndex }),
      ]
    }
    const title = newTabTitle(op, context)
    const sheetId = newSheetId(context)
    context.created.push(title)
    context.newIds.push(sheetId)
    return [{ addSheet: { properties: { sheetId, title } } }, update({ sheetId, rowIndex: 0, columnIndex: 0 })]
  },
  tabs(op, context) {
    const { source, at } = planPivot(op, context)
    return tabsOfAreas([source, ...(at === undefined ? [] : [at])])
  },
  describe(op, context) {
    const { source, at } = planPivot(op, context)
    const values = op.pivot_values.map(
      (entry) =>
        ("formula" in entry
          ? `${entry.summarize ?? CUSTOM_SUMMARY} ${fewValues([entry.formula])}`
          : `${entry.summarize ?? DEFAULT_SUMMARY} of ${entry.column.toUpperCase()}`) +
        (entry.name === undefined ? "" : ` as ${JSON.stringify(entry.name)}`),
    )
    const words = [
      ...groupWords("rows", op.pivot_rows),
      ...groupWords("columns", op.pivot_columns),
      `values ${values.join(", ")}`,
      ...(op.pivot_filters ?? []).map(
        (filter) => `only ${filter.column.toUpperCase()} in (${fewValues(plainValues(filter.show))})`,
      ),
    ]
    const place =
      at === undefined
        ? `on a new tab ${JSON.stringify(newTabTitle(op, context))}`
        : `at ${areaLabel(at)}, overwriting the cells it fills`
    return `pivot of ${areaLabel(source)} ${place}: ${words.join("; ")}`
  },
})

/** What `pivot_delete` works out before it changes anything: the cell, refused when the cells read right before the plan hold no pivot table there. */
function planDelete(op: z.output<typeof pivotDeleteSchema>, context: OperationContext) {
  const at = singleCell(resolveRange(context.tabs, op.at), "at")
  const found = context.read.get(op)?.pivots
  if (found !== undefined && found.definitions.length === 0) {
    throw new ToolError(
      "invalid_argument",
      `No pivot table is anchored at ${areaLabel(at)}; the \`structure\` read lists where each one is.`,
    )
  }
  return { at, definitions: found?.definitions ?? [] }
}

/** `pivot_delete`: removes the pivot table anchored at a cell, with the cells of its output. */
export const pivotDeleteOperation = defineOperation({
  schema: pivotDeleteSchema,
  needs: ["objects"],
  reads: (op, { tabs }) => ({ pivots: [singleCell(resolveRange(tabs, op.at), "at")] }),
  requests(op, context) {
    const { at } = planDelete(op, context)
    return [{ updateCells: { range: at.grid, fields: "pivotTable", rows: [{ values: [{}] }] } }]
  },
  tabs: (op, { tabs }) => [singleCell(resolveRange(tabs, op.at), "at").tab],
  describe(op, context) {
    const { at } = planDelete(op, context)
    return `pivot_delete ${areaLabel(at)} with its output, which is the cells from there to the end of its tab`
  },
  loses: (op, context) => [{ area: toTabEnd(planDelete(op, context).at, context) }],
  pins: (op, context) => [planDelete(op, context).definitions],
})
