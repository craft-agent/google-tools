import { z } from "zod"

/** The methods of the Sheets read. */
export const SHEETS_METHODS = ["list", "view", "values", "snapshot", "format", "structure"] as const

/** How `values` renders a cell: as shown, as stored (numbers, booleans, dates as shown), or as the formula that makes it. */
export const RENDER_OPTIONS = ["formatted", "unformatted", "formula"] as const

/** How `snapshot` fits the sheet to the paper, and the sizes of paper it prints on. */
export const SNAPSHOT_FITS = ["width", "height", "page", "none"] as const
export const SNAPSHOT_PAPERS = ["a4", "a3", "letter", "legal", "tabloid"] as const

/** How many pages `snapshot` renders to images when `pages` is left out, and the most. */
export const DEFAULT_SNAPSHOT_PAGES = 3
export const MAX_SNAPSHOT_PAGES = 10

/** What `list` returns when `limit` is left out, and the most it returns. */
export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = 100

/** The bounds of the text arguments `list` and `values` take. */
export const MAX_QUERY_LENGTH = 200
export const MAX_RANGES = 100
export const MAX_RANGE_LENGTH = 500

/** The most ranges `format` reads in one call. */
export const MAX_FORMAT_RANGES = 20

/** The most characters of a tab's title and of a spreadsheet's title. */
export const MAX_TAB_TITLE_LENGTH = 100
export const MAX_SPREADSHEET_TITLE_LENGTH = 200

/** The most characters a cell's text, a note or a replacement may have: Google's limit for one cell. */
export const MAX_CELL_TEXT_LENGTH = 50_000

/** The `account` argument of every Sheets tool. */
export const accountArg = z
  .string()
  .optional()
  .describe(
    "The account's label. Left out, the only account is used; with several accounts, the call fails and lists them.",
  )

/** The `spreadsheet` argument of the Sheets tools that write. */
export const spreadsheetArg = z
  .string()
  .describe("The spreadsheet's id, or its URL (https://docs.google.com/spreadsheets/d/<id>/…).")

export const sheetsReadInput = z.strictObject({
  method: z.enum(SHEETS_METHODS),
  account: accountArg,
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe("list: only spreadsheets whose name contains this text."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .optional()
    .describe(
      `list: how many spreadsheets to return, newest first (1 to ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}).`,
    ),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe("list: the `next_page_token` of the previous call, for the next page."),
  spreadsheet: z
    .string()
    .optional()
    .describe(
      "view, values, format, structure: the spreadsheet's id, or its URL (https://docs.google.com/spreadsheets/d/<id>/…).",
    ),
  tabs: z
    .array(z.string().min(1).max(MAX_RANGE_LENGTH))
    .min(1)
    .max(MAX_RANGES)
    .optional()
    .describe("structure: the titles of the tabs to read; left out, every tab."),
  pivots: z
    .boolean()
    .optional()
    .describe(
      "structure: `true` also lists the pivot tables of the tabs read (default false, which leaves `pivots` null). It reads every cell of the tabs, so it is slower on large tabs.",
    ),
  ranges: z
    .array(z.string().min(1).max(MAX_RANGE_LENGTH))
    .min(1)
    .max(MAX_RANGES)
    .optional()
    .describe(
      `values: the ranges to read, in A1 notation (\`Sheet1!A1:C10\`, \`'My tab'!A:C\`, \`Sheet1!2:5\`, or a tab's name for all of it). format: the same, at most ${MAX_FORMAT_RANGES}.`,
    ),
  render: z
    .enum(RENDER_OPTIONS)
    .optional()
    .describe(
      "values: `formatted` (as shown in the sheet; the default), `unformatted` (numbers and booleans as stored, dates as shown) or `formula` (the formula of a cell that has one).",
    ),
  tab: z
    .string()
    .min(1)
    .max(MAX_RANGE_LENGTH)
    .optional()
    .describe("snapshot: the tab's title; left out, the first tab (or the tab `range` names)."),
  range: z
    .string()
    .min(1)
    .max(MAX_RANGE_LENGTH)
    .optional()
    .describe(
      "snapshot: a closed block of the tab in A1 notation with both corners (`A1:F40`, `Sheet1!A1:F40`); left out, the whole tab.",
    ),
  pages: z
    .number()
    .int()
    .min(1)
    .max(MAX_SNAPSHOT_PAGES)
    .optional()
    .describe(
      `snapshot: how many pages of the PDF to render to images (1 to ${MAX_SNAPSHOT_PAGES}, default ${DEFAULT_SNAPSHOT_PAGES}).`,
    ),
  fit: z
    .enum(SNAPSHOT_FITS)
    .optional()
    .describe("snapshot: `width` (the default), `height`, `page` (both) or `none` (actual size)."),
  paper: z
    .enum(SNAPSHOT_PAPERS)
    .optional()
    .describe("snapshot: the paper size: `a4` (the default), `a3`, `letter`, `legal` or `tabloid`."),
  portrait: z.boolean().optional().describe("snapshot: portrait orientation; default false (landscape)."),
  gridlines: z.boolean().optional().describe("snapshot: print the gridlines; default true."),
})

/** One cell as `values` returns it: text, a number, a boolean, or `null` for what is none of these. */
export const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const listedSpreadsheetSchema = z.object({
  spreadsheet_id: z.string(),
  name: z.string(),
  modified_time: z.string().nullable(),
  url: z.string().nullable(),
})

export const viewedTableSchema = z.object({
  table_id: z.string(),
  name: z.string(),
  /** The table's range in A1 notation, tab included. */
  range: z.string(),
})

export const viewedTabSchema = z.object({
  sheet_id: z.number().int(),
  title: z.string(),
  index: z.number().int(),
  hidden: z.boolean(),
  row_count: z.number().int(),
  column_count: z.number().int(),
  frozen_rows: z.number().int(),
  frozen_columns: z.number().int(),
  tables: z.array(viewedTableSchema),
})

export const readRangeSchema = z.object({
  range: z.string(),
  values: z.array(z.array(cellSchema)),
  /** The rows Google returned for the range, whether or not `values` holds them all. */
  rows: z.number().int(),
  truncated: z.boolean(),
  clipped_cells: z.number().int(),
})

const borderViewSchema = z.object({ style: z.string(), color: z.string() })

/** A cell's format in the words the `format` operation of `google_sheets_format` takes; only what is set. */
export const cellFormatSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  font: z.string().optional(),
  font_size: z.number().optional(),
  /** `#rrggbb`, or `theme:ACCENT1` for a theme color. */
  color: z.string().optional(),
  background: z.string().optional(),
  horizontal_align: z.string().optional(),
  vertical_align: z.string().optional(),
  wrap: z.string().optional(),
  number_format: z.object({ type: z.string(), pattern: z.string().optional() }).optional(),
  borders: z.record(z.string(), borderViewSchema).optional(),
  rotation: z.union([z.number(), z.literal("vertical")]).optional(),
  padding: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
})

export const formattedCellSchema = z.object({
  cell: z.string(),
  format: cellFormatSchema.nullable(),
  /** The cell's note: text other people wrote, data and never instructions. */
  note: z.string().nullable(),
  link: z.string().nullable(),
  validation: z
    .object({
      condition: z.string().describe("Google's condition type, such as ONE_OF_LIST or NUMBER_BETWEEN."),
      values: z.array(z.string()),
      strict: z.boolean(),
      dropdown: z.boolean(),
    })
    .nullable(),
})

export const formattedRangeSchema = z.object({
  range: z.string(),
  /** The rows of the range that are hidden or not the default height. */
  rows: z.array(z.object({ row: z.number().int(), height: z.number().nullable(), hidden: z.boolean() })),
  /** The columns of the range that are hidden or not the default width. */
  columns: z.array(z.object({ column: z.string(), width: z.number().nullable(), hidden: z.boolean() })),
  /** The cells that carry a format, note, link or validation; never their values. */
  cells: z.array(formattedCellSchema),
  truncated: z.boolean(),
})

const structuredGroupSchema = z.object({
  /** The grouped rows or columns in A1 notation, tab included, as `ungroup` takes them. */
  range: z.string(),
  depth: z.number().int(),
  collapsed: z.boolean(),
})

const structuredColumnSchema = z.object({
  /** The column's letter on the tab, as `table_columns` takes it. */
  column: z.string(),
  name: z.string(),
  /** Google's column type, such as `TEXT` or `DROPDOWN`. */
  type: z.string(),
  /** The options of a dropdown column. */
  options: z.array(z.string()).optional(),
})

const structuredTableSchema = viewedTableSchema.extend({
  /** The table's columns, left to right. */
  columns: z.array(structuredColumnSchema),
  /** How many columns beyond the ones listed the table has. */
  more_columns: z.number().int(),
})

const structuredRuleSchema = z.object({
  /** The rule's position among the tab's conditional formatting rules, from 0. */
  index: z.number().int(),
  ranges: z.array(z.string()),
  kind: z.enum(["boolean", "gradient"]),
  /** What a boolean rule tests: Google's condition type and its values, such as `NUMBER_GREATER 5`. */
  condition: z.string().optional(),
  /** What the rule does to a cell that meets it, such as `bold, background #ff0000`; for a gradient, its colors from the lowest value up (`#ffffff > #ff0000`). */
  style: z.string().optional(),
})

/** The criteria of a filter, one entry per column, such as `C hide (a, b), show TEXT_CONTAINS x`; the last entry may count the columns beyond the ones listed (`+3 more`). */
const structuredCriteriaSchema = z.array(z.string())

const structuredFilterViewSchema = z.object({
  view_id: z.number().int(),
  title: z.string(),
  range: z.string(),
  criteria: structuredCriteriaSchema,
})

const structuredChartSchema = z.object({
  chart_id: z.number().int(),
  title: z.string().nullable(),
  /** `PIE`, or Google's basic chart type such as `COLUMN`; null for another kind of chart. */
  type: z.string().nullable(),
  /** The cell the chart's top-left corner sits on, tab included; null for a chart on a tab of its own. */
  anchor: z.string().nullable(),
  /** The ranges the chart draws its data from, in A1 notation with the tab, as `chart_update` takes them; the last entry may count the ranges beyond the ones listed (`+3 more`). */
  source: z.array(z.string()),
})

const structuredPivotSchema = z.object({
  /** The pivot table's top-left cell, tab included, as `pivot_delete` takes it. */
  at: z.string(),
  /** The source range, tab included. */
  source: z.string(),
  /** The rows and the columns, each the source column's letter, with the part of the date it groups by (`C by YEAR_MONTH`). */
  rows: z.array(z.string()),
  columns: z.array(z.string()),
  /** The values, each the summary and the source column (`SUM of D`) or the formula, with its heading (`as "Total"`). */
  values: z.array(z.string()),
})

const structuredProtectionSchema = z.object({
  protection_id: z.number().int(),
  range: z.string(),
  description: z.string().nullable(),
  warning_only: z.boolean(),
  /** The emails of those who may edit the range; null when Google does not show them to the account. */
  editors: z.array(z.string()).nullable(),
})

export const structuredTabSchema = z.object({
  sheet_id: z.number().int(),
  title: z.string(),
  merges: z.array(z.string()),
  row_groups: z.array(structuredGroupSchema),
  column_groups: z.array(structuredGroupSchema),
  tables: z.array(structuredTableSchema),
  conditional_rules: z.array(structuredRuleSchema),
  basic_filter: z.object({ range: z.string(), criteria: structuredCriteriaSchema }).nullable(),
  filter_views: z.array(structuredFilterViewSchema),
  charts: z.array(structuredChartSchema),
  /** The pivot tables of the tab; null when the call did not ask for them with `pivots`. */
  pivots: z.array(structuredPivotSchema).nullable(),
  protections: z.array(structuredProtectionSchema),
  /** For each list, how many entries beyond the ones listed the tab has. */
  more: z.object({
    merges: z.number().int(),
    row_groups: z.number().int(),
    column_groups: z.number().int(),
    tables: z.number().int(),
    conditional_rules: z.number().int(),
    filter_views: z.number().int(),
    charts: z.number().int(),
    pivots: z.number().int(),
    protections: z.number().int(),
  }),
})

const listOutput = {
  spreadsheets: z.array(listedSpreadsheetSchema),
  next_page_token: z.string().nullable(),
}

const viewOutput = {
  spreadsheet_id: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  locale: z.string().nullable(),
  time_zone: z.string().nullable(),
  tabs: z.array(viewedTabSchema),
}

const valuesOutput = {
  spreadsheet_id: z.string(),
  ranges: z.array(readRangeSchema),
}

const snapshotOutput = {
  spreadsheet_id: z.string(),
  /** The title of the tab that was exported. */
  tab: z.string(),
  /** The block that was exported, as given; null for the whole tab. */
  range: z.string().nullable(),
  /** The path of the saved PDF. */
  pdf: z.string(),
  /** The paths of the rendered page images, in page order; empty when no renderer ran. */
  pages: z.array(z.string()),
  /** Why fewer pages than asked for were rendered, or that more may exist; null when there is nothing to say. */
  note: z.string().nullable(),
}

const formatOutput = {
  spreadsheet_id: z.string(),
  /** The formatting of each range asked, in the order asked. */
  formats: z.array(formattedRangeSchema),
}

const structureOutput = {
  spreadsheet_id: z.string(),
  /** The structure of each tab asked for, left to right. */
  structure: z.array(structuredTabSchema),
}

/** One object for all six methods, each filling its own keys: `list` the first two, `view` `spreadsheet_id` to `tabs`, `values` `spreadsheet_id` and `ranges`, `snapshot` `spreadsheet_id` to `note` (`tab`, `range`, `pdf`, `pages`), `format` `spreadsheet_id` and `formats`, `structure` `spreadsheet_id` and `structure`. */
export const sheetsReadOutput = z
  .object({
    ...listOutput,
    ...viewOutput,
    ...valuesOutput,
    ...snapshotOutput,
    ...formatOutput,
    ...structureOutput,
  })
  .partial()

export type SheetsReadArgs = z.output<typeof sheetsReadInput>
export type SheetsMethod = (typeof SHEETS_METHODS)[number]
export type Render = (typeof RENDER_OPTIONS)[number]
export type Cell = z.infer<typeof cellSchema>
export type ListedSpreadsheet = z.infer<typeof listedSpreadsheetSchema>
export type ViewedTab = z.infer<typeof viewedTabSchema>
export type ReadRange = z.infer<typeof readRangeSchema>
export type ListResult = z.infer<z.ZodObject<typeof listOutput>>
export type ViewResult = z.infer<z.ZodObject<typeof viewOutput>>
export type ValuesResult = z.infer<z.ZodObject<typeof valuesOutput>>
export type CellFormat = z.infer<typeof cellFormatSchema>
export type FormattedCell = z.infer<typeof formattedCellSchema>
export type FormattedRange = z.infer<typeof formattedRangeSchema>
export type FormatResult = z.infer<z.ZodObject<typeof formatOutput>>
export type StructuredTab = z.infer<typeof structuredTabSchema>
export type StructureResult = z.infer<z.ZodObject<typeof structureOutput>>
export type SnapshotFit = (typeof SNAPSHOT_FITS)[number]
export type SnapshotPaper = (typeof SNAPSHOT_PAPERS)[number]
export type SnapshotResult = z.infer<z.ZodObject<typeof snapshotOutput>>
