import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { quoteTab } from "./a1"
import {
  METADATA_LOCATION_TYPES,
  placeOf,
  readAllMetadata,
  searchMetadata,
  type DeveloperMetadata,
  type MetadataLocation,
} from "./metadata"
import { SHEETS_ROUTES } from "./routes"
import type { MetadataResult } from "./schemas"
import { readTabs, tabOfRange, type SheetTab } from "./tabs"

/** The most entries one metadata read lists; the rest are counted in `more`. */
export const MAX_METADATA_ENTRIES = 200

/** Where a location sorts among the others: the spreadsheet first, then each tab in turn, the tab itself before its rows and its rows before its columns. */
const KIND_RANKS = { tab: 0, rows: 1, columns: 2 } as const

/** The numbers a location sorts by: its tab's position (none for the spreadsheet, which comes first), its kind and where it starts. */
function sortPosition(location: MetadataLocation, tabs: readonly SheetTab[]): [number, number, number] {
  if (location.kind === "spreadsheet") return [-1, 0, 0]
  const index = tabs.find((tab) => tab.sheetId === location.sheetId)?.index ?? tabs.length
  return [index, KIND_RANKS[location.kind], location.kind === "tab" ? 0 : location.startIndex]
}

/** The metadata ordered by location, then key, then id. */
function sorted(metadata: readonly DeveloperMetadata[], tabs: readonly SheetTab[]): DeveloperMetadata[] {
  return metadata
    .map((entry) => ({ entry, position: sortPosition(entry.location, tabs) }))
    .sort((a, b) => {
      const place = a.position.findIndex((number, index) => number !== b.position[index])
      if (place >= 0) return a.position[place]! - b.position[place]!
      if (a.entry.key !== b.entry.key) return a.entry.key < b.entry.key ? -1 : 1
      return a.entry.metadataId - b.entry.metadataId
    })
    .map(({ entry }) => entry)
}

/** Whether the label may use the metadata search, which Google closes to a label that cannot write. */
async function maySearch(client: GoogleClient): Promise<boolean> {
  try {
    await client.requireScopes(SHEETS_ROUTES.metadataSearch)
    return true
  } catch (error) {
    if (error instanceof ToolError && error.code === "unauthenticated") return false
    throw error
  }
}

/** The metadata `key` and `value` select, as the search selects them: the ones given must equal, exactly and case-sensitively. */
function selected(
  metadata: readonly DeveloperMetadata[],
  { key, value }: Pick<Parameters<typeof readMetadata>[2], "key" | "value">,
): DeveloperMetadata[] {
  return metadata.filter(
    (entry) => (key === undefined || entry.key === key) && (value === undefined || entry.value === value),
  )
}

/**
 * The developer metadata of a spreadsheet, filtered by `key` and `value` when
 * given and, with `tabs`, kept to the metadata on those tabs and their rows
 * and columns (a title the spreadsheet lacks is `invalid_argument`). A label
 * that may write searches, with a lookup for each kind of location; one that
 * can only read takes every mark from the spreadsheet itself and filters
 * them here, with the same answer. It lists at most `MAX_METADATA_ENTRIES`,
 * ordered by location then key, and counts the rest.
 */
export async function readMetadata(
  client: GoogleClient,
  id: string,
  filters: { key?: string; value?: string; tabs?: readonly string[] },
): Promise<MetadataResult> {
  const { tabs } = await readTabs(client, id)
  const picked =
    filters.tabs === undefined
      ? undefined
      : new Set(filters.tabs.map((title) => tabOfRange(tabs, quoteTab(title)).sheetId))
  const found = (await maySearch(client))
    ? await searchMetadata(
        client,
        id,
        METADATA_LOCATION_TYPES.map((locationType) => ({
          locationType,
          ...(filters.key !== undefined && { metadataKey: filters.key }),
          ...(filters.value !== undefined && { metadataValue: filters.value }),
        })),
      )
    : selected(await readAllMetadata(client, id), filters)
  const kept = found.filter(
    ({ location }) => picked === undefined || (location.kind !== "spreadsheet" && picked.has(location.sheetId)),
  )
  return {
    spreadsheet_id: id,
    metadata: sorted(kept, tabs)
      .slice(0, MAX_METADATA_ENTRIES)
      .map((entry) => ({
        metadata_id: entry.metadataId,
        key: entry.key,
        value: entry.value ?? null,
        visibility: entry.visibility,
        location: placeOf(entry.location, tabs),
      })),
    more: Math.max(kept.length - MAX_METADATA_ENTRIES, 0),
  }
}
