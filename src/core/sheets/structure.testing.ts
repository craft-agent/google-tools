import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL } from "./read.testing"
import {
  BATCH_UPDATE_URL,
  SPREADSHEET,
  ORDERS_TABLE,
  post,
  valuesHandler,
  writeFixture,
  writesOf,
} from "./write.testing"

/** Fixtures the `google_sheets_add` and `google_sheets_restructure` tests share, on top of the write fixtures. */

/** The rows or the columns `startIndex` up to `endIndex` of the tab `Plan` (id 0), as a dimension range. */
export const PLAN_ROWS = (startIndex: number, endIndex: number) => ({
  sheetId: 0,
  dimension: "ROWS",
  startIndex,
  endIndex,
})
export const PLAN_COLUMNS = (startIndex: number, endIndex: number) => ({
  sheetId: 0,
  dimension: "COLUMNS",
  startIndex,
  endIndex,
})

/** `SPREADSHEET` with its tab `My Tab` hidden. */
export const WITH_HIDDEN_TAB = {
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.map((sheet) =>
    sheet.properties.title === "My Tab" ? { ...sheet, properties: { ...sheet.properties, hidden: true } } : sheet,
  ),
}

/** `SPREADSHEET` with only the tab `Plan` left. */
export const ONLY_PLAN = {
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.filter((sheet) => sheet.properties.title === "Plan"),
}

const BLOCK = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
  startRowIndex,
  endRowIndex,
  startColumnIndex,
  endColumnIndex,
})

/** A block of the tab `Plan` (id 0) as Google's `GridRange`: rows `startRowIndex` up to `endRowIndex`, columns `startColumnIndex` up to `endColumnIndex`. */
export const PLAN_GRID = (
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
) => ({ sheetId: 0, ...BLOCK(startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) })

/** The tab `Plan` (id 0), 100 rows by 10 columns, with two tables, three conditional rules, a basic filter and two filter views. */
const PLAN_WITH_OBJECTS = {
  properties: { title: "Plan", gridProperties: { rowCount: 100, columnCount: 10 } },
  tables: [
    {
      ...ORDERS_TABLE,
      columnProperties: [
        { columnName: "Item", columnType: "TEXT" },
        { columnIndex: 1, columnName: "Qty", columnType: "DOUBLE" },
        {
          columnIndex: 2,
          columnName: "Status",
          columnType: "DROPDOWN",
          dataValidationRule: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "open" }] } },
        },
      ],
    },
    { tableId: "tbl-costs-2", name: "Costs", range: BLOCK(0, 4, 4, 6) },
  ],
  conditionalFormats: [
    {
      ranges: [BLOCK(1, 50, 1, 2)],
      booleanRule: {
        condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "5" }] },
        format: { textFormat: { bold: true } },
      },
    },
    {
      ranges: [BLOCK(1, 50, 2, 3)],
      gradientRule: {
        minpoint: { colorStyle: { rgbColor: { red: 1 } } },
        maxpoint: { colorStyle: { themeColor: "ACCENT1" } },
      },
    },
    {
      ranges: [BLOCK(1, 50, 3, 4)],
      booleanRule: {
        condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "late" }] },
        format: { backgroundColor: { red: 1 } },
      },
    },
  ],
  basicFilter: {
    range: BLOCK(0, 50, 0, 6),
    filterSpecs: [{ columnIndex: 2, filterCriteria: { hiddenValues: ["x"] } }],
  },
  filterViews: [
    { filterViewId: 9001, title: "Open", range: BLOCK(0, 50, 0, 6), filterSpecs: [] },
    { filterViewId: 9002, title: "Mine", range: BLOCK(0, 20, 0, 3) },
  ],
}

/** `SPREADSHEET` whose tab `Plan` has `PLAN_WITH_OBJECTS`'s tables, rules, filter and filter views. */
export const WITH_OBJECTS = {
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.map((sheet) => (sheet.properties.title === "Plan" ? PLAN_WITH_OBJECTS : sheet)),
}

/** The data validation of the second cell of the first row, as the read of grid data answers it. */
export const VALIDATED = {
  sheets: [
    {
      data: [
        {
          rowData: [
            {
              values: [
                {},
                {
                  dataValidation: {
                    condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "a" }] },
                    strict: true,
                    showCustomUi: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/** The body of the one batch a call sent. */
type Batch = { requests: unknown[]; includeSpreadsheetInResponse: boolean }

type Sent = {
  spreadsheet?: unknown
  reply?: unknown
  rows?: (range: string, render: string) => unknown[][] | undefined
  /** What the read of the data validation of ranges (the spreadsheet with grid data) answers. */
  validation?: unknown
}

/** A GET of the spreadsheet that answers `validation` to the read of grid data and `spreadsheet` to any other. */
export function spreadsheetHandler(spreadsheet: unknown = SPREADSHEET, validation: unknown = {}): FakeHandler {
  return {
    method: "GET",
    url: SPREADSHEET_URL,
    reply: ({ url }) => ({ json: url.searchParams.has("includeGridData") ? validation : spreadsheet }),
  }
}

/** Runs one call of `tool` on a fake that answers `spreadsheet`, the values of every range as `rows` and the batch as `reply`; returns the result and the one batch it sent. */
async function send(tool: "add" | "restructure", args: object, { spreadsheet, reply, rows, validation }: Sent) {
  const h = await writeFixture([
    spreadsheetHandler(spreadsheet, validation),
    valuesHandler(rows ?? (() => [])),
    post(BATCH_UPDATE_URL, reply),
  ])
  const result = await h[tool]({ spreadsheet: SPREADSHEET_ID, ...args })
  const writes = writesOf(h.requests)
  if (writes.length !== 1) throw new Error(`Expected one batch; the fake received ${writes.length}.`)
  return { h, result, body: writes[0]!.json as Batch }
}

/** Runs a call of `tool` on `WITH_OBJECTS` (or the spreadsheet given) that is refused, and returns its error once it has checked that nothing was written. */
export async function refusedCall(
  tool: "add" | "restructure",
  operations: unknown[],
  { spreadsheet = WITH_OBJECTS, rows, validation }: Sent = {},
) {
  const h = await writeFixture([
    spreadsheetHandler(spreadsheet, validation),
    valuesHandler(rows ?? (() => [])),
    post(BATCH_UPDATE_URL),
  ])
  const error = await toolError(h[tool]({ spreadsheet: SPREADSHEET_ID, operations }))
  if (writesOf(h.requests).length > 0) throw new Error("A refused call wrote to the fake.")
  return error
}

/** One call of `google_sheets_add` with `operations`. */
export const sendAdd = (operations: unknown[], sent: Sent = {}) => send("add", { operations }, sent)

/** One call of `google_sheets_restructure` with `operations`, and `expect` when given. */
export const sendRestructure = (operations: unknown[], sent: Sent & { expect?: unknown[] } = {}) =>
  send("restructure", { operations, ...(sent.expect !== undefined && { expect: sent.expect }) }, sent)
