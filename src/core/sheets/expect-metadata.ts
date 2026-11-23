import type { GoogleClient } from "../google/client"
import { columnLetters } from "./a1"
import type { MetadataGuard } from "./expect"
import { resolveRange } from "./grid"
import { searchMetadata, type DeveloperMetadata, type MetadataLocation, type MetadataLookup } from "./metadata"
import type { SheetTab } from "./tabs"

/** A guard whose cell did not show what the call expected: the cell, what it should have shown and what it showed. */
export type Difference = { range: string; expected: string; found: string }

/** The direction a guard looks along. */
type Along = NonNullable<MetadataGuard["along"]>

/** How many of the places that carry a mark a difference names before it counts the rest. */
const MAX_PLACES_NAMED = 3

/** The search term for the marks of each direction. */
const LOCATION_TYPES = { rows: "ROW", columns: "COLUMN" } as const

/** Metadata that sits on rows or columns, whose places are indexes. */
type Marked = DeveloperMetadata & { location: Extract<MetadataLocation, { startIndex: number }> }

/** Whether the entry sits on rows (or columns, as `along` says) of the tab. */
function isMarkOn(entry: DeveloperMetadata, along: Along, sheetId: number): entry is Marked {
  return entry.location.kind === along && entry.location.sheetId === sheetId
}

/** What a difference says a guard expected: the key, and `=value` when the guard names one. */
function expectedText({ metadata }: MetadataGuard): string {
  return metadata.value === undefined ? metadata.key : `${metadata.key}=${metadata.value}`
}

/** One place that carries a mark as a difference names it: `12` for one row, `10–14` for several, `C` for one column, `C–E` for several. */
function placeText({ location }: Marked, along: Along): string {
  const name = (index: number) => (along === "rows" ? String(index + 1) : columnLetters(index))
  const first = name(location.startIndex)
  const last = name(Math.max(location.endIndex - 1, location.startIndex))
  return first === last ? first : `${first}–${last}`
}

/** Where the marks that match are, as a difference says it, from the top or the left; none is said so. */
function foundText(matches: readonly Marked[], along: Along): string {
  if (matches.length === 0) return `no ${along === "rows" ? "row" : "column"} carries it`
  const ordered = [...matches].sort((a, b) => a.location.startIndex - b.location.startIndex)
  const named = ordered.slice(0, MAX_PLACES_NAMED).map((entry) => placeText(entry, along))
  const more = ordered.length - MAX_PLACES_NAMED
  return `${along} ${named.join(", ")}${more > 0 ? ` (+${more} more)` : ""} carry it`
}

/**
 * Checks that the row (or column) of each guard's one cell carries developer
 * metadata with the key, and the value when given, on a location that covers
 * it: one search for every distinct key, value and direction. Gives, for each
 * guard in order, what differs, or `undefined` when the mark is there. A guard
 * on a tab the spreadsheet lacks is `invalid_argument`, before anything is sent.
 */
export async function metadataDifferences(
  client: GoogleClient,
  id: string,
  tabs: readonly SheetTab[],
  guards: readonly MetadataGuard[],
): Promise<(Difference | undefined)[]> {
  const cells = guards.map((guard) => {
    const { tab, grid } = resolveRange(tabs, guard.range)
    const along = guard.along ?? "rows"
    const index = along === "rows" ? grid.startRowIndex : grid.startColumnIndex
    return { guard, along, sheetId: tab.sheetId, index: index ?? 0 }
  })
  const lookups = new Map<string, MetadataLookup>(
    cells.map(({ guard, along }) => {
      const { key, value } = guard.metadata
      const lookup: MetadataLookup = {
        metadataKey: key,
        ...(value !== undefined && { metadataValue: value }),
        locationType: LOCATION_TYPES[along],
      }
      return [JSON.stringify(lookup), lookup]
    }),
  )
  const found = await searchMetadata(client, id, [...lookups.values()])
  return cells.map(({ guard, along, sheetId, index }): Difference | undefined => {
    const { key, value } = guard.metadata
    const matches = found.filter(
      (entry): entry is Marked =>
        isMarkOn(entry, along, sheetId) && entry.key === key && (value === undefined || entry.value === value),
    )
    const covered = matches.some(({ location }) => location.startIndex <= index && index < location.endIndex)
    return covered ? undefined : { range: guard.range, expected: expectedText(guard), found: foundText(matches, along) }
  })
}
