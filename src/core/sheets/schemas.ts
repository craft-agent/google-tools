import { z } from "zod"

/** The methods of the Sheets read. */
export const SHEETS_METHODS = ["list", "view", "values"] as const

/** How `values` renders a cell: as shown, as stored (numbers, booleans, dates as shown), or as the formula that makes it. */
export const RENDER_OPTIONS = ["formatted", "unformatted", "formula"] as const

/** What `list` returns when `limit` is left out, and the most it returns. */
export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = 100

/** The bounds of the text arguments `list` and `values` take. */
export const MAX_QUERY_LENGTH = 200
export const MAX_RANGES = 100
export const MAX_RANGE_LENGTH = 500

export const sheetsReadInput = z.strictObject({
  method: z.enum(SHEETS_METHODS),
  account: z
    .string()
    .optional()
    .describe(
      "The account's label. Left out, the only account is used; with several accounts, the call fails and lists them.",
    ),
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
    .describe("view, values: the spreadsheet's id, or its URL (https://docs.google.com/spreadsheets/d/<id>/…)."),
  ranges: z
    .array(z.string().min(1).max(MAX_RANGE_LENGTH))
    .min(1)
    .max(MAX_RANGES)
    .optional()
    .describe(
      "values: the ranges to read, in A1 notation (`Sheet1!A1:C10`, `'My tab'!A:C`, `Sheet1!2:5`, or a tab's name for all of it).",
    ),
  render: z
    .enum(RENDER_OPTIONS)
    .optional()
    .describe(
      "values: `formatted` (as shown in the sheet; the default), `unformatted` (numbers and booleans as stored, dates as shown) or `formula` (the formula of a cell that has one).",
    ),
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

/** One object for all three methods, each filling its own keys: `list` the first two, `view` `spreadsheet_id` to `tabs`, `values` `spreadsheet_id` and `ranges`. */
export const sheetsReadOutput = z
  .object({
    ...listOutput,
    ...viewOutput,
    ...valuesOutput,
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
