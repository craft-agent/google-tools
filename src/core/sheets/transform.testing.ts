import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID } from "./read.testing"
import { spreadsheetHandler } from "./structure.testing"
import { googleSheetsTransform } from "./transform"
import { BATCH_UPDATE_URL, SPREADSHEET, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

/** Fixtures the `google_sheets_transform` tests share, on top of the write fixtures. */

/** What the fake Google answers: the spreadsheet, the values of every range, the read of grid data (notes) and the batch. */
type Sent = {
  spreadsheet?: unknown
  rows?: (range: string, render: string) => unknown[][] | undefined
  notes?: unknown
  reply?: unknown
  expect?: unknown[]
}

/** The arguments of one call of `google_sheets_transform` with `operations`. */
export const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

/** The handlers of a fake Google for a call that `sent` describes. */
function handlersFor({ spreadsheet = SPREADSHEET, rows, notes, reply }: Sent) {
  return [spreadsheetHandler(spreadsheet, notes), valuesHandler(rows ?? (() => [])), post(BATCH_UPDATE_URL, reply)]
}

/** Runs one call of `operations` on a fake Google; returns the result and the requests of the one batch it sent. */
export async function sendTransform(operations: unknown[], sent: Sent = {}) {
  const h = await writeFixture(handlersFor(sent))
  const result = await h.transform({
    ...call(...operations),
    ...(sent.expect !== undefined && { expect: sent.expect }),
  })
  const writes = writesOf(h.requests)
  if (writes.length !== 1) throw new Error(`Expected one batch; the fake received ${writes.length}.`)
  return { h, result, requests: (writes[0]!.json as { requests: unknown[] }).requests }
}

/** Describes one call of `operations` to a fake Google, with `args` beside them (`expect`); returns the description and the fixture. */
export async function describeTransform(operations: unknown[], sent: Sent = {}, args: object = {}) {
  const h = await writeFixture(handlersFor(sent))
  const description = await googleSheetsTransform.describe!(
    googleSheetsTransform.input.parse({ ...call(...operations), ...args }),
    h.ctx,
  )
  return { h, description: description! }
}

/** Runs a call that is refused, and returns its error once it has checked that nothing was written. */
export async function refusedTransform(operations: unknown[], sent: Sent = {}) {
  const h = await writeFixture(handlersFor(sent))
  const error = await toolError(
    h.transform({ ...call(...operations), ...(sent.expect !== undefined && { expect: sent.expect }) }),
  )
  if (writesOf(h.requests).length > 0) throw new Error("A refused call wrote to the fake.")
  return error
}
