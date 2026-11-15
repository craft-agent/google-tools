import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { gridRangeA1 } from "./a1"
import type { ResolvedRange } from "./grid"
import type { SheetObjects, TabSize } from "./objects"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { SheetTab } from "./tabs"
import { MAX_CELLS, fetchValueRanges } from "./values"

const VALIDATION_FIELDS = "sheets.data.rowData.values.dataValidation"
const NOTE_FIELDS = "sheets.data.rowData.values.note"

/** What an operation needs read from the cells before it is planned: the ranges whose data validation or notes it plans on, the range whose first row names the columns of a table, and the cell whose text it restyles. */
export type CellsWanted = {
  validation?: readonly ResolvedRange[]
  notes?: readonly ResolvedRange[]
  header?: ResolvedRange
  text?: ResolvedRange
}

/** What some ranges hold of one cell property (their data validation, their notes): each value Google reports, with where it is, so a change of value or of place shows. */
export type CellDefinitions = { definitions: unknown[] }

/** What `readCells` found, for the parts that were wanted; `text` is the cell's content as written when it is text, else `null`. */
export type CellsRead = {
  validation?: CellDefinitions
  notes?: CellDefinitions
  header?: string[]
  text?: string | null
}

const cellsReply = z.object({
  sheets: z
    .array(
      z.object({
        data: z
          .array(
            z.object({
              rowData: z.array(z.object({ values: z.array(z.record(z.string(), z.unknown())).optional() })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

/** How many cells the range covers on a tab of `size`; an end the range leaves open is the tab's last, and unbounded where the tab's size is not known. */
function cellsIn({ grid }: ResolvedRange, size: TabSize): number {
  const rows = (grid.endRowIndex ?? size.rows ?? Infinity) - (grid.startRowIndex ?? 0)
  const columns = (grid.endColumnIndex ?? size.columns ?? Infinity) - (grid.startColumnIndex ?? 0)
  return rows <= 0 || columns <= 0 ? 0 : rows * columns
}

/** The range in A1 notation by the title the tab has now, which an earlier operation of the call may be about to change. */
function currentA1(tabs: readonly SheetTab[], { tab, grid }: ResolvedRange): string {
  return gridRangeA1(tabs.find((candidate) => candidate.sheetId === tab.sheetId)?.title ?? tab.title, grid)
}

/** A property of a cell to read: its `field`, the field mask that asks for it, the `key` it is listed under and what the errors call it. */
type CellProperty = { field: string; fields: string; key: string; what: string }

/**
 * Reads one property of the cells of the ranges, at most `MAX_CELLS` cells in
 * all: a range that holds more, or that is open where the tab's size is
 * unknown, is `invalid_argument` asking for a narrower one.
 */
async function readCellProperty(
  client: GoogleClient,
  id: string,
  areas: readonly ResolvedRange[],
  tabs: readonly SheetTab[],
  objects: SheetObjects,
  property: CellProperty,
): Promise<CellDefinitions> {
  const cells = areas.reduce((total, area) => total + cellsIn(area, objects.sizes.get(area.tab.sheetId) ?? {}), 0)
  if (cells > MAX_CELLS) {
    throw new ToolError(
      "invalid_argument",
      `The ranges span more than ${MAX_CELLS} cells, which is the most whose ${property.what} can be read at once; narrow them.`,
    )
  }
  const reply = parseReply(
    cellsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { ranges: areas.map((area) => currentA1(tabs, area)), includeGridData: true, fields: property.fields },
    }),
    `the ${property.what}`,
  )
  const definitions = (reply.sheets ?? []).flatMap((sheet, sheetPosition) =>
    (sheet.data ?? []).flatMap((data, rangePosition) =>
      (data.rowData ?? []).flatMap((row, rowPosition) =>
        (row.values ?? []).flatMap((cell, columnPosition) =>
          cell[property.field] === undefined
            ? []
            : [
                {
                  sheet: sheetPosition,
                  range: rangePosition,
                  row: rowPosition,
                  column: columnPosition,
                  [property.key]: cell[property.field],
                },
              ],
        ),
      ),
    ),
  )
  return { definitions }
}

const VALIDATION_PROPERTY: CellProperty = {
  field: "dataValidation",
  fields: VALIDATION_FIELDS,
  key: "rule",
  what: "data validation",
}
const NOTE_PROPERTY: CellProperty = { field: "note", fields: NOTE_FIELDS, key: "note", what: "notes" }

/** The texts of the first row of the range, as the sheet shows them. */
async function readHeader(
  client: GoogleClient,
  id: string,
  tabs: readonly SheetTab[],
  area: ResolvedRange,
): Promise<string[]> {
  const [range] = await fetchValueRanges(client, id, [currentA1(tabs, area)], "formatted")
  return (range?.values[0] ?? []).map(String)
}

/** The content of the cell as written (a formula as its formula) when it is text; `null` for a cell that is empty or holds a number or a boolean. */
async function readText(
  client: GoogleClient,
  id: string,
  tabs: readonly SheetTab[],
  area: ResolvedRange,
): Promise<string | null> {
  const [range] = await fetchValueRanges(client, id, [currentA1(tabs, area)], "formula")
  const cell = range?.values[0]?.[0]
  return typeof cell === "string" ? cell : null
}

/**
 * Reads what an operation asked to have read before it is planned, from the
 * sheet as it stands now. `tabs` are the tabs as Google reports them, whose
 * titles name the ranges even where an earlier operation renames a tab.
 */
export async function readCells(
  client: GoogleClient,
  id: string,
  wanted: CellsWanted,
  tabs: readonly SheetTab[],
  objects: SheetObjects,
): Promise<CellsRead> {
  return {
    ...(wanted.validation !== undefined && {
      validation: await readCellProperty(client, id, wanted.validation, tabs, objects, VALIDATION_PROPERTY),
    }),
    ...(wanted.notes !== undefined && {
      notes: await readCellProperty(client, id, wanted.notes, tabs, objects, NOTE_PROPERTY),
    }),
    ...(wanted.header !== undefined && { header: await readHeader(client, id, tabs, wanted.header) }),
    ...(wanted.text !== undefined && { text: await readText(client, id, tabs, wanted.text) }),
  }
}
