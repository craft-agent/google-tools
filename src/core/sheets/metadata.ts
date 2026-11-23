import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { gridRangeA1 } from "./a1"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { MAX_METADATA_KEY_LENGTH, MAX_METADATA_VALUE_LENGTH, METADATA_VISIBILITIES } from "./schemas"
import type { SheetTab } from "./tabs"

export type MetadataVisibility = (typeof METADATA_VISIBILITIES)[number]

/** Google's words for the visibilities. */
const GOOGLE_VISIBILITIES: Record<MetadataVisibility, string> = { document: "DOCUMENT", project: "PROJECT" }

/** The largest id Google gives developer metadata. */
const MAX_METADATA_ID = 2_147_483_647

/** The fields of the spreadsheet that carry developer metadata (its own, each tab's, each row's and column's) and no cell values. */
const METADATA_FIELDS =
  "developerMetadata,sheets(properties(sheetId,title,index),developerMetadata,data(rowMetadata(developerMetadata),columnMetadata(developerMetadata)))"

/** The kinds of place developer metadata sits on, as Google's search filters name them. */
export const METADATA_LOCATION_TYPES = ["SPREADSHEET", "SHEET", "ROW", "COLUMN"] as const

export type MetadataLocationType = (typeof METADATA_LOCATION_TYPES)[number]

/** The key of developer metadata: text that is data, not a name Google reserves. */
export const metadataKeyArg = z.string().min(1).max(MAX_METADATA_KEY_LENGTH)

/** The value of developer metadata; empty means none. */
export const metadataValueArg = z.string().max(MAX_METADATA_VALUE_LENGTH)

/** The id of developer metadata, as `google_sheets_read`'s `metadata` method lists it: a whole number Google keeps within 32 bits. */
export const metadataIdArg = z.number().int().min(0).max(MAX_METADATA_ID)

/** The visibility argument of the operations that make or change developer metadata. */
export const metadataVisibilityArg = z.enum(METADATA_VISIBILITIES)

/** Where developer metadata sits: on the spreadsheet, on a tab, or on one row or column of a tab (zero-based, end-exclusive). */
export type MetadataLocation =
  | { kind: "spreadsheet" }
  | { kind: "tab"; sheetId: number }
  | { kind: "rows" | "columns"; sheetId: number; startIndex: number; endIndex: number }

/** One piece of developer metadata as the tools work with it; the operations move it as they are built in order. */
export type DeveloperMetadata = {
  metadataId: number
  key: string
  value: string | undefined
  visibility: MetadataVisibility
  location: MetadataLocation
  /** The metadata as Google reported it, which a pin covers. */
  definition: unknown
}

/** What a search selects: the fields that are given must all match. */
export type MetadataLookup = {
  metadataId?: number
  metadataKey?: string
  metadataValue?: string
  locationType?: MetadataLocationType
}

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const developerMetadataReply = z.object({
  metadataId: gridNumber,
  metadataKey: z.string().optional(),
  metadataValue: z.string().optional(),
  visibility: z.string().optional(),
  location: z
    .object({
      spreadsheet: z.boolean().optional(),
      sheetId: gridNumber,
      dimensionRange: z
        .object({
          sheetId: gridNumber,
          dimension: z.string().optional(),
          startIndex: gridNumber,
          endIndex: gridNumber,
        })
        .optional(),
    })
    .optional(),
})

const searchReply = z.object({
  matchedDeveloperMetadata: z.array(z.object({ developerMetadata: developerMetadataReply.optional() })).optional(),
})

type MetadataReply = z.output<typeof developerMetadataReply>

/** Something that may carry developer metadata: the spreadsheet, a tab, one row or one column. */
const markedReply = z.object({ developerMetadata: z.array(developerMetadataReply).optional() })

const spreadsheetMarksReply = markedReply.extend({
  sheets: z
    .array(
      markedReply.extend({
        data: z
          .array(
            z.object({ rowMetadata: z.array(markedReply).optional(), columnMetadata: z.array(markedReply).optional() }),
          )
          .optional(),
      }),
    )
    .optional(),
})

/** Where the reply says the metadata sits. */
function locationOf(location: MetadataReply["location"]): MetadataLocation {
  const range = location?.dimensionRange
  if (range !== undefined) {
    return {
      kind: range.dimension === "COLUMNS" ? "columns" : "rows",
      sheetId: range.sheetId ?? 0,
      startIndex: range.startIndex ?? 0,
      endIndex: range.endIndex ?? 0,
    }
  }
  if (location?.spreadsheet === true) return { kind: "spreadsheet" }
  return { kind: "tab", sheetId: location?.sheetId ?? 0 }
}

/** The metadata as the tools work with it, from what Google reports; an empty value is none. */
function metadataOf(reply: MetadataReply): DeveloperMetadata {
  return {
    metadataId: reply.metadataId ?? 0,
    key: reply.metadataKey ?? "",
    value: reply.metadataValue === undefined || reply.metadataValue === "" ? undefined : reply.metadataValue,
    visibility: reply.visibility === GOOGLE_VISIBILITIES.project ? "project" : "document",
    location: locationOf(reply.location),
    definition: reply,
  }
}

/** The metadata of the replies, each id once, in the order first seen. */
function distinct(replies: readonly MetadataReply[]): DeveloperMetadata[] {
  const found = new Map<number, DeveloperMetadata>()
  for (const reply of replies) {
    const metadata = metadataOf(reply)
    if (!found.has(metadata.metadataId)) found.set(metadata.metadataId, metadata)
  }
  return [...found.values()]
}

/** Google's word for a visibility. */
export function googleVisibility(visibility: MetadataVisibility): string {
  return GOOGLE_VISIBILITIES[visibility]
}

/** The location as a `location` of a create or an update request. */
export function locationBody(location: MetadataLocation): Record<string, unknown> {
  if (location.kind === "spreadsheet") return { spreadsheet: true }
  if (location.kind === "tab") return { sheetId: location.sheetId }
  const { sheetId, startIndex, endIndex } = location
  return { dimensionRange: { sheetId, dimension: location.kind === "rows" ? "ROWS" : "COLUMNS", startIndex, endIndex } }
}

/** Where metadata sits as a result lists it: its kind, the title of its tab (none for the spreadsheet) and, for a row or column, its A1 range. */
export type MetadataPlace = { kind: MetadataLocation["kind"]; tab: string | null; range: string | null }

/** The location in the words of a result, with the tab titles Google reports now. */
export function placeOf(
  location: MetadataLocation,
  tabs: readonly Pick<SheetTab, "sheetId" | "title">[],
): MetadataPlace {
  if (location.kind === "spreadsheet") return { kind: "spreadsheet", tab: null, range: null }
  const title = tabs.find((tab) => tab.sheetId === location.sheetId)?.title ?? ""
  if (location.kind === "tab") return { kind: "tab", tab: title, range: null }
  const { startIndex, endIndex } = location
  const bounds =
    location.kind === "rows"
      ? { startRowIndex: startIndex, endRowIndex: endIndex }
      : { startColumnIndex: startIndex, endColumnIndex: endIndex }
  return { kind: location.kind, tab: title, range: gridRangeA1(title, bounds) }
}

/**
 * The developer metadata the lookups select, each once, in one search
 * (nothing is sent for no lookup). A reply not in the expected shape is
 * `upstream_error`.
 */
export async function searchMetadata(
  client: GoogleClient,
  id: string,
  lookups: readonly MetadataLookup[],
): Promise<DeveloperMetadata[]> {
  if (lookups.length === 0) return []
  const reply = parseReply(
    searchReply,
    await client.request(SHEETS_ROUTES.metadataSearch, {
      params: { spreadsheet_id: id },
      body: { dataFilters: lookups.map((developerMetadataLookup) => ({ developerMetadataLookup })) },
    }),
    "the developer metadata",
  )
  return distinct(
    (reply.matchedDeveloperMetadata ?? []).flatMap(({ developerMetadata }) =>
      developerMetadata === undefined ? [] : [developerMetadata],
    ),
  )
}

/**
 * Every piece of developer metadata of the spreadsheet, each once, read from
 * the spreadsheet itself with a field mask that holds no cell values: the
 * search is closed to a label that cannot write, this is not. The reply grows
 * with the rows and columns of the tabs. A reply not in the expected shape is
 * `upstream_error`.
 */
export async function readAllMetadata(client: GoogleClient, id: string): Promise<DeveloperMetadata[]> {
  const reply = parseReply(
    spreadsheetMarksReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: METADATA_FIELDS },
    }),
    "the developer metadata",
  )
  const holders = [
    reply,
    ...(reply.sheets ?? []).flatMap((sheet) => [
      sheet,
      ...(sheet.data ?? []).flatMap((grid) => [...(grid.rowMetadata ?? []), ...(grid.columnMetadata ?? [])]),
    ]),
  ]
  return distinct(holders.flatMap((holder) => holder.developerMetadata ?? []))
}

/** The metadata with the ids, as Google reports it now; an id Google does not show is left out. */
export function readMetadataByIds(
  client: GoogleClient,
  id: string,
  ids: readonly number[],
): Promise<DeveloperMetadata[]> {
  return searchMetadata(
    client,
    id,
    [...new Set(ids)].map((metadataId) => ({ metadataId })),
  )
}

/** The `metadata_id` of each operation that names one. */
export function metadataIdsOf(operations: readonly object[]): number[] {
  return operations.flatMap((op) => {
    const { metadata_id: metadataId } = op as { metadata_id?: unknown }
    return typeof metadataId === "number" ? [metadataId] : []
  })
}
