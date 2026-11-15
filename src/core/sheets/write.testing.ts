import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeRequest } from "../google/fake-google.testing"
import { invoke, type ToolSpec } from "../tool"
import { googleSheetsAdd } from "./add"
import { googleSheetsAppend } from "./append"
import { googleSheetsClear } from "./clear"
import { googleSheetsCreate } from "./create"
import { googleSheetsEdit } from "./edit"
import { googleSheetsFormat } from "./format"
import { googleSheetsProtect } from "./protect"
import { BATCH_GET_URL, SPREADSHEET_URL, answer, callOf, fixture } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { SHEETS_WRITE_SCOPE } from "./scopes"
import { googleSheetsTabAdd } from "./tab-add"
import { googleSheetsTransform } from "./transform"

/** Fixtures the Sheets write tests share, on top of the read fixtures: a label logged in to write, and a spreadsheet of three tabs. */

export const UPDATE_URL = `${SPREADSHEET_URL}/values:batchUpdate`
export const CLEAR_URL = `${SPREADSHEET_URL}/values:batchClear`
export const BATCH_UPDATE_URL = `${SPREADSHEET_URL}:batchUpdate`
export const METADATA_SEARCH_URL = `${SPREADSHEET_URL}/developerMetadata:search`
export const CREATE_URL = "https://sheets.googleapis.com/v4/spreadsheets"

/** The URL of the append route for `range`, encoded as the client encodes it. */
export const appendUrl = (range: string) => `${SPREADSHEET_URL}/values/${encodeURIComponent(range)}:append`

/** What a label logged in to read and write Sheets holds. */
export const SHEETS_WRITE_CREDENTIAL: Credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, SHEETS_WRITE_SCOPE] }

/** The table of the first tab, `Plan`, which covers A1:C5. */
export const ORDERS_TABLE = {
  tableId: "tbl-orders-1",
  name: "Orders",
  range: { startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 3 },
}

/** A spreadsheet of `Plan` (id and index left out, as Google does for 0), `My Tab` and `a/b`; the tabs are listed out of order on purpose. */
export const SPREADSHEET = {
  properties: { title: "Budget 2027" },
  sheets: [
    { properties: { sheetId: 5, title: "a/b", index: 2 } },
    { properties: { sheetId: 77, title: "My Tab", index: 1 } },
    { properties: { title: "Plan" }, tables: [ORDERS_TABLE] },
  ],
}

/** A POST handler for `url` that answers `reply`. */
export const post = (url: string, reply: unknown = {}): FakeHandler => ({ method: "POST", url, reply: { json: reply } })

/** The spreadsheet's metadata, answered to every read of it. */
export const metadata = (reply: unknown = SPREADSHEET): FakeHandler => answer(SPREADSHEET_URL, reply)

/** A `values:batchGet` answering `rows` for each range asked, by the render option the call asked for. */
export function valuesHandler(rows: (range: string, render: string) => unknown[][] | undefined): FakeHandler {
  return {
    method: "GET",
    url: BATCH_GET_URL,
    reply: ({ url }) => {
      const render = url.searchParams.get("valueRenderOption") ?? ""
      const ranges = url.searchParams.getAll("ranges")
      return { json: { valueRanges: ranges.map((range) => ({ range, values: rows(range, render) })) } }
    },
  }
}

/** The requests that are not reads of the spreadsheet, its values or its developer metadata: the writes the fake received. */
export function writesOf(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter(
    (request) =>
      request.method === "POST" &&
      request.url.hostname === "sheets.googleapis.com" &&
      callOf(request) !== `POST ${METADATA_SEARCH_URL}`,
  )
}

/** The tools wired to a fake Google that answers `handlers`, for a label logged in to read and write. */
export async function writeFixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = SHEETS_WRITE_CREDENTIAL,
) {
  const h = await fixture(handlers, credential)
  /** A tool's result, whose keys each test reads for itself. */
  const run = (spec: ToolSpec, args: unknown): Promise<Record<string, any>> => invoke(spec, args, h.ctx)
  return {
    ...h,
    append: (args: unknown) => run(googleSheetsAppend, args),
    edit: (args: unknown) => run(googleSheetsEdit, args),
    clear: (args: unknown) => run(googleSheetsClear, args),
    create: (args: unknown) => run(googleSheetsCreate, args),
    tabAdd: (args: unknown) => run(googleSheetsTabAdd, args),
    format: (args: unknown) => run(googleSheetsFormat, args),
    add: (args: unknown) => run(googleSheetsAdd, args),
    restructure: (args: unknown) => run(googleSheetsRestructure, args),
    transform: (args: unknown) => run(googleSheetsTransform, args),
    protect: (args: unknown) => run(googleSheetsProtect, args),
    /** `METHOD origin+path` of each request the fake received, the token refresh left out. */
    names: () => h.calls().map(callOf),
  }
}
