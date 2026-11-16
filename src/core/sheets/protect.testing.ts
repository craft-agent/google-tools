import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL } from "./read.testing"
import { PLAN_GRID } from "./structure.testing"
import { BATCH_UPDATE_URL, SPREADSHEET, writeFixture, writesOf } from "./write.testing"

/** Fixtures the `google_sheets_protect` tests share, on top of the structure fixtures. */

/** The account's own address, which Google lists among the editors of what it made. */
export const ME = "me@example.test"

/** A block of `Plan` (id 0) that `Header` protects: its first row, for the account and `ann`. */
export const HEADER = {
  protectedRangeId: 7,
  range: PLAN_GRID(0, 1, 0, 6),
  description: "Header",
  editors: { users: [ME, "ann@example.test"] },
  requestingUserCanEdit: true,
}

/** A cell of `Plan` that `Locked` protects, with a person, a group and the whole domain as editors. */
export const LOCKED = {
  protectedRangeId: 9,
  range: PLAN_GRID(2, 3, 0, 1),
  description: "Locked",
  editors: { users: [ME, "bob@example.test"], groups: ["team@example.test"], domainUsersCanEdit: true },
  requestingUserCanEdit: true,
}

/** `My Tab` (id 77), whole, which only warns. */
export const WARNS = {
  protectedRangeId: 8,
  range: { sheetId: 77 },
  warningOnly: true,
  requestingUserCanEdit: true,
}

/** A protection of `Plan` the account may not change: Google leaves `requestingUserCanEdit` out. */
export const THEIRS = { protectedRangeId: 12, range: PLAN_GRID(5, 6, 0, 1), description: "Theirs" }

/** Two protections of `a/b` (id 5) that share a label. */
export const SHARED = [10, 11].map((protectedRangeId, index) => ({
  protectedRangeId,
  range: { sheetId: 5, startRowIndex: index, endRowIndex: index + 1, startColumnIndex: 0, endColumnIndex: 1 },
  description: "Shared",
  editors: { users: [ME] },
  requestingUserCanEdit: true,
}))

/** The whole of `a/b` (id 5), with a column left editable. */
export const WHOLE_TAB = {
  protectedRangeId: 13,
  range: { sheetId: 5 },
  unprotectedRanges: [{ sheetId: 5, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 1, endColumnIndex: 2 }],
  description: "Whole",
  editors: { users: [ME] },
  requestingUserCanEdit: true,
}

/** The protections of the fixture spreadsheet. */
export const PROTECTIONS = [HEADER, LOCKED, WARNS, THEIRS, ...SHARED, WHOLE_TAB]

type Protected = { range: { sheetId?: number }; [field: string]: unknown }

/** What the read of the protected ranges answers for `protections`: each listed under the tab its range lies on. */
export function protectedSheets(protections: readonly Protected[]) {
  const ids = [...new Set(protections.map((protection) => protection.range.sheetId ?? 0))]
  return {
    sheets: ids.map((sheetId) => ({
      properties: { sheetId },
      protectedRanges: protections.filter((protection) => (protection.range.sheetId ?? 0) === sheetId),
    })),
  }
}

export type Sent = {
  /** The protections the spreadsheet has before the call. */
  protections?: readonly Protected[]
  /** What the read after the write answers, as `protections` when left out; an error status when `null`. */
  after?: readonly Protected[] | null
  /** What the batch answers. */
  reply?: unknown
}

/** A GET of the spreadsheet that answers its tabs, and its protections before the batch and `after` once the batch is in. */
export function protectHandlers({ protections = PROTECTIONS, after = protections, reply = {} }: Sent): FakeHandler[] {
  let written = false
  return [
    {
      method: "GET",
      url: SPREADSHEET_URL,
      reply: ({ url }) => {
        if (!(url.searchParams.get("fields") ?? "").includes("protectedRanges")) return { json: SPREADSHEET }
        if (written && after === null) {
          return { status: 500, json: { error: { code: 500, message: "Backend busy", status: "INTERNAL" } } }
        }
        return { json: protectedSheets(written ? after! : protections) }
      },
    },
    {
      method: "POST",
      url: BATCH_UPDATE_URL,
      reply: () => {
        written = true
        return { json: reply }
      },
    },
  ]
}

/** The body of the one batch a call sent. */
type Batch = { requests: Record<string, any>[]; includeSpreadsheetInResponse: boolean }

/** Runs one call of `google_sheets_protect` on a fake with `sent`'s protections; returns the result and the one batch it sent. */
export async function sendProtect(operations: unknown[], sent: Sent = {}) {
  const h = await writeFixture(protectHandlers(sent))
  const result = await h.protect({ spreadsheet: SPREADSHEET_ID, operations })
  const writes = writesOf(h.requests)
  if (writes.length !== 1) throw new Error(`Expected one batch; the fake received ${writes.length}.`)
  return { h, result, body: writes[0]!.json as Batch }
}

/** Runs a call that is refused, and returns its error once it has checked that nothing was written. */
export async function refusedProtect(operations: unknown[], sent: Sent = {}) {
  const h = await writeFixture(protectHandlers(sent))
  const error = await toolError(h.protect({ spreadsheet: SPREADSHEET_ID, operations }))
  if (writesOf(h.requests).length > 0) throw new Error("A refused call wrote to the fake.")
  return error
}
