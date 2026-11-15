import { SPREADSHEET_ID } from "./read.testing"
import { BATCH_UPDATE_URL, SPREADSHEET, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

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

/** The body of the one batch a call sent. */
type Batch = { requests: unknown[]; includeSpreadsheetInResponse: boolean }

type Sent = {
  spreadsheet?: unknown
  reply?: unknown
  rows?: (range: string, render: string) => unknown[][] | undefined
}

/** Runs one call of `tool` on a fake that answers `spreadsheet`, the values of every range as `rows` and the batch as `reply`; returns the result and the one batch it sent. */
async function send(tool: "add" | "restructure", args: object, { spreadsheet, reply, rows }: Sent) {
  const h = await writeFixture([
    metadata(spreadsheet),
    valuesHandler(rows ?? (() => [])),
    post(BATCH_UPDATE_URL, reply),
  ])
  const result = await h[tool]({ spreadsheet: SPREADSHEET_ID, ...args })
  const writes = writesOf(h.requests)
  if (writes.length !== 1) throw new Error(`Expected one batch; the fake received ${writes.length}.`)
  return { h, result, body: writes[0]!.json as Batch }
}

/** One call of `google_sheets_add` with `operations`. */
export const sendAdd = (operations: unknown[], sent: Sent = {}) => send("add", { operations }, sent)

/** One call of `google_sheets_restructure` with `operations`, and `expect` when given. */
export const sendRestructure = (operations: unknown[], sent: Sent & { expect?: unknown[] } = {}) =>
  send("restructure", { operations, ...(sent.expect !== undefined && { expect: sent.expect }) }, sent)
