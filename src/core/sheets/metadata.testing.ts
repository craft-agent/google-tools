import type { FakeHandler } from "../google/fake-google.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL } from "./read.testing"
import {
  BATCH_UPDATE_URL,
  CLEAR_URL,
  METADATA_SEARCH_URL,
  SPREADSHEET,
  UPDATE_URL,
  metadata,
  post,
  valuesHandler,
} from "./write.testing"

/** Fixtures the developer metadata tests share, on top of the write fixtures. */

/** One piece of developer metadata as Google reports it. */
export type Mark = {
  metadataId: number
  metadataKey: string
  metadataValue?: string
  visibility: string
  location: Record<string, unknown>
}

/** What a search sends for each filter. */
type Lookup = { metadataId?: number; metadataKey?: string; metadataValue?: string; locationType?: string }

/** Where metadata on the spreadsheet itself sits. */
export const ON_SPREADSHEET = { locationType: "SPREADSHEET", spreadsheet: true }

/** Where metadata on a tab sits; Google leaves out the id 0. */
export const onTab = (sheetId: number) => ({ locationType: "SHEET", ...(sheetId !== 0 && { sheetId }) })

/** Where metadata on the rows `startIndex` up to `endIndex` of a tab sits; Google leaves out a 0. */
export const onRows = (sheetId: number, startIndex: number, endIndex: number) => ({
  locationType: "ROW",
  dimensionRange: {
    ...(sheetId !== 0 && { sheetId }),
    dimension: "ROWS",
    ...(startIndex !== 0 && { startIndex }),
    endIndex,
  },
})

/** Where metadata on the columns `startIndex` up to `endIndex` of a tab sits. */
export const onColumns = (sheetId: number, startIndex: number, endIndex: number) => ({
  locationType: "COLUMN",
  dimensionRange: {
    ...(sheetId !== 0 && { sheetId }),
    dimension: "COLUMNS",
    ...(startIndex !== 0 && { startIndex }),
    endIndex,
  },
})

/** A piece of metadata, `DOCUMENT` visible unless `visibility` says otherwise. */
export function mark(
  metadataId: number,
  metadataKey: string,
  location: Record<string, unknown>,
  metadataValue?: string,
  visibility = "DOCUMENT",
): Mark {
  return { metadataId, metadataKey, ...(metadataValue !== undefined && { metadataValue }), visibility, location }
}

/** The spreadsheet's metadata: its owner, the stage of `Plan` and of `My Tab`, the orders on two rows of `Plan` (5 and 12) and one of `My Tab`, and the region of `Plan`'s column C. */
export const MARKS: Mark[] = [
  mark(1, "owner", ON_SPREADSHEET, "finance"),
  mark(2, "stage", onTab(0), "draft"),
  mark(3, "order", onRows(0, 11, 12), "A-100"),
  mark(4, "order", onRows(0, 4, 5), "A-200"),
  mark(5, "region", onColumns(0, 2, 3), "east"),
  mark(6, "stage", onTab(77), undefined, "PROJECT"),
  mark(7, "order", onRows(77, 0, 1), "B-1"),
  mark(8, "alpha", onRows(0, 4, 5)),
]

/** Whether the mark is one the filter selects, as Google reads a lookup: every field it gives must match. */
function fits(entry: Mark, lookup: Lookup): boolean {
  return (
    (lookup.metadataId === undefined || entry.metadataId === lookup.metadataId) &&
    (lookup.metadataKey === undefined || entry.metadataKey === lookup.metadataKey) &&
    (lookup.metadataValue === undefined || entry.metadataValue === lookup.metadataValue) &&
    (lookup.locationType === undefined || entry.location.locationType === lookup.locationType)
  )
}

/** The lookups of the one search a request carried. */
export function lookupsOf(request: { json?: unknown }): Lookup[] {
  const { dataFilters } = request.json as { dataFilters: { developerMetadataLookup: Lookup }[] }
  return dataFilters.map((filter) => filter.developerMetadataLookup)
}

/** A search that answers the marks any of its filters selects, once each; Google leaves the reply empty for none. */
export function searchHandler(marks: readonly Mark[] = MARKS): FakeHandler {
  return {
    method: "POST",
    url: METADATA_SEARCH_URL,
    reply: (request) => {
      const lookups = lookupsOf(request)
      const matched = marks.filter((entry) => lookups.some((lookup) => fits(entry, lookup)))
      return {
        json:
          matched.length === 0
            ? {}
            : { matchedDeveloperMetadata: matched.map((developerMetadata) => ({ developerMetadata })) },
      }
    },
  }
}

/** The id of the tab a mark sits on or in; Google leaves out the id 0. */
function sheetIdOf(entry: Mark): number {
  const range = entry.location.dimensionRange as { sheetId?: number } | undefined
  return (range ?? (entry.location as { sheetId?: number })).sheetId ?? 0
}

/** What Google answers for the rows (or columns) of a tab: one entry for each up to the last one marked, empty where nothing is marked, and a mark on every row it covers. */
function dimensionMarks(marks: readonly Mark[], locationType: string, sheetId: number): unknown[] {
  const here = marks.filter((entry) => entry.location.locationType === locationType && sheetIdOf(entry) === sheetId)
  const span = (entry: Mark) => entry.location.dimensionRange as { startIndex?: number; endIndex: number }
  const length = Math.max(0, ...here.map((entry) => span(entry).endIndex))
  return Array.from({ length }, (_, index) => {
    const covering = here.filter((entry) => (span(entry).startIndex ?? 0) <= index && index < span(entry).endIndex)
    return covering.length === 0 ? {} : { developerMetadata: covering }
  })
}

/** The spreadsheet as the field mask of the marks cuts it: the marks of the spreadsheet, of each tab of `SPREADSHEET`, and of their rows and columns. */
function marksReply(marks: readonly Mark[]): unknown {
  const on = (locationType: string, sheetId?: number) =>
    marks.filter(
      (entry) =>
        entry.location.locationType === locationType && (sheetId === undefined || sheetIdOf(entry) === sheetId),
    )
  return {
    developerMetadata: on("SPREADSHEET"),
    sheets: SPREADSHEET.sheets.map(({ properties }) => {
      const sheetId = (properties as { sheetId?: number }).sheetId ?? 0
      return {
        properties,
        developerMetadata: on("SHEET", sheetId),
        data: [
          {
            rowMetadata: dimensionMarks(marks, "ROW", sheetId),
            columnMetadata: dimensionMarks(marks, "COLUMN", sheetId),
          },
        ],
      }
    }),
  }
}

/** A read of the spreadsheet that answers the marks of `marks` when the field mask asks for them, and the tabs otherwise. */
export function marksSpreadsheetHandler(marks: readonly Mark[] = MARKS): FakeHandler {
  return {
    method: "GET",
    url: SPREADSHEET_URL,
    reply: ({ url }) => ({
      json: url.searchParams.get("fields")?.includes("developerMetadata") ? marksReply(marks) : SPREADSHEET,
    }),
  }
}

/** A fake that answers the spreadsheet's tabs, `Plan!A1` as `Total`, a search over `marks` and every write. */
export const guardHandlers = (marks = MARKS): FakeHandler[] => [
  metadata(),
  valuesHandler((range, render) => (render === "FORMATTED_VALUE" && range === "Plan!A1" ? [["Total"]] : [])),
  searchHandler(marks),
  post(UPDATE_URL),
  post(CLEAR_URL, {}),
  post(BATCH_UPDATE_URL),
]

/** The arguments of an edit of `Plan!A2:B2` guarded by `expectation`. */
export const holds = (...expectation: unknown[]) => ({
  spreadsheet: SPREADSHEET_ID,
  data: [{ range: "Plan!A2:B2", values: [["x", 1]] }],
  expect: expectation,
})
