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

/** What an operation needs read from the cells before it is planned: the ranges whose data validation it plans on, and the range whose first row names the columns of a table. */
export type CellsWanted = { validation?: readonly ResolvedRange[]; header?: ResolvedRange }

/** The data validation of some ranges: each rule Google reports, with where it is, so a change of rule or of place shows. */
export type RangeValidation = { definitions: unknown[] }

/** What `readCells` found, for the parts that were wanted. */
export type CellsRead = { validation?: RangeValidation; header?: string[] }

const validationReply = z.object({
  sheets: z
    .array(
      z.object({
        data: z
          .array(
            z.object({
              rowData: z
                .array(
                  z.object({
                    values: z
                      .array(z.object({ dataValidation: z.record(z.string(), z.unknown()).optional() }))
                      .optional(),
                  }),
                )
                .optional(),
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

/**
 * Reads the data validation of the ranges, at most `MAX_CELLS` cells in all:
 * a range that holds more, or that is open where the tab's size is unknown, is
 * `invalid_argument` asking for a narrower one.
 */
async function readValidation(
  client: GoogleClient,
  id: string,
  areas: readonly ResolvedRange[],
  tabs: readonly SheetTab[],
  objects: SheetObjects,
): Promise<RangeValidation> {
  const cells = areas.reduce((total, area) => total + cellsIn(area, objects.sizes.get(area.tab.sheetId) ?? {}), 0)
  if (cells > MAX_CELLS) {
    throw new ToolError(
      "invalid_argument",
      `The ranges span more than ${MAX_CELLS} cells, which is the most whose data validation can be read at once; narrow them.`,
    )
  }
  const reply = parseReply(
    validationReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { ranges: areas.map((area) => currentA1(tabs, area)), includeGridData: true, fields: VALIDATION_FIELDS },
    }),
    "the data validation",
  )
  const definitions = (reply.sheets ?? []).flatMap((sheet, sheetPosition) =>
    (sheet.data ?? []).flatMap((data, rangePosition) =>
      (data.rowData ?? []).flatMap((row, rowPosition) =>
        (row.values ?? []).flatMap((cell, columnPosition) =>
          cell.dataValidation === undefined
            ? []
            : [
                {
                  sheet: sheetPosition,
                  range: rangePosition,
                  row: rowPosition,
                  column: columnPosition,
                  rule: cell.dataValidation,
                },
              ],
        ),
      ),
    ),
  )
  return { definitions }
}

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
      validation: await readValidation(client, id, wanted.validation, tabs, objects),
    }),
    ...(wanted.header !== undefined && { header: await readHeader(client, id, tabs, wanted.header) }),
  }
}
