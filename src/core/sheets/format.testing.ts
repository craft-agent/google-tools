import { SPREADSHEET_ID } from "./read.testing"
import { BATCH_UPDATE_URL, SPREADSHEET, metadata, post, writeFixture, writesOf } from "./write.testing"

/** Fixtures the `google_sheets_format` tests share, on top of the write fixtures. */

/** The grid range of the tab `Plan` (id 0) with `bounds`. */
export const PLAN = (bounds: object) => ({ sheetId: 0, ...bounds })

/** The body of the one batch a call sent. */
type Batch = { requests: unknown[]; includeSpreadsheetInResponse: boolean }

/** Runs one call of operations on a fake that answers `spreadsheet`, and returns the result and the one batch it sent. */
export async function send(operations: unknown[], spreadsheet: unknown = SPREADSHEET) {
  const h = await writeFixture([metadata(spreadsheet), post(BATCH_UPDATE_URL)])
  const result = await h.format({ spreadsheet: SPREADSHEET_ID, operations })
  const writes = writesOf(h.requests)
  if (writes.length !== 1) throw new Error(`Expected one batch; the fake received ${writes.length}.`)
  return { h, result, body: writes[0]!.json as Batch }
}
