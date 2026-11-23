import type { FakeHandler } from "../google/fake-google.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, fixture } from "./read.testing"

/** Fixtures the snapshot tests share: the export's reply and the spreadsheet's tabs. */

export const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export`

/** Where a made-up Google hands the export off to: a signed address on the sheets download host. */
export const HANDOFF_URL = "https://doc-10-60-sheets.googleusercontent.com/export/opaqueA/opaqueB/1780315200000/1/2/3"

/** The signed query of the handoff address, which no message may show. */
export const HANDOFF_QUERY = "?sig=madeUpSignature&ttl=300"

/** The export answering with a redirect to `location`, as Google answers every export. */
export const handoffRedirect = (location: string): FakeHandler => ({
  method: "GET",
  url: EXPORT_URL,
  reply: { status: 307, headers: { location } },
})

/** The bytes of a made-up PDF. */
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 made up")

/** The spreadsheet "Budget 2026", whose tabs are `Sheet1` (gid 0) and `Q1 Plan` (gid 42). */
export const TABS_REPLY = {
  properties: { title: "Budget 2026" },
  sheets: [
    { properties: { sheetId: 0, title: "Sheet1", index: 0 } },
    { properties: { sheetId: 42, title: "Q1 Plan", index: 1 } },
  ],
}

/** The name `Budget 2026` and `Sheet1` give a snapshot, at the fixtures' clock (2026-06-01 12:00 UTC). */
export const SHEET1_STEM = "Budget_2026-Sheet1-20260601-120000"

/** The tabs and a PDF export, which a snapshot call runs over. */
export const tabsHandler: FakeHandler = answer(SPREADSHEET_URL, TABS_REPLY)
export const pdfHandler: FakeHandler = {
  method: "GET",
  url: EXPORT_URL,
  reply: { bytes: PDF_BYTES, headers: { "content-type": "application/pdf" } },
}

/** A snapshot of the spreadsheet with the arguments given beside the method and spreadsheet. */
export const snapshotArgs = (more: Record<string, unknown> = {}) => ({
  method: "snapshot",
  spreadsheet: SPREADSHEET_ID,
  ...more,
})

/** A `PATH` with no program on it, so no real renderer runs. */
const NO_PROGRAMS_PATH = "/nonexistent-programs"

/** The fixtures with the tabs and a PDF export answering; `env` is the runtime's environment, with no renderer on its `PATH` unless it names one. */
export function snapshotFixture(
  env: Record<string, string> = { PATH: NO_PROGRAMS_PATH },
  handlers: FakeHandler[] = [pdfHandler],
) {
  return fixture([tabsHandler, ...handlers], undefined, env)
}
