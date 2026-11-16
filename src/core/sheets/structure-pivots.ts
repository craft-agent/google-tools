import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { columnLetters } from "./a1"
import { areaLabel } from "./operation-ranges"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { StructuredTab } from "./schemas"

/** The read of the pivot tables: the cells that hold one, which Google gives with the cell data of each tab, and nothing else of them. */
const PIVOT_FIELDS =
  "sheets(properties(sheetId),data(startRow,startColumn,rowData(values(pivotTable(source," +
  "rows(sourceColumnOffset,groupRule),columns(sourceColumnOffset,groupRule)," +
  "values(sourceColumnOffset,summarizeFunction,formula,name))))))"

/** What a value of a pivot table is summarized with when Google names no function. */
const DEFAULT_SUMMARY = "SUM"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const groupReply = z.object({
  sourceColumnOffset: gridNumber,
  groupRule: z.object({ dateTimeRule: z.object({ type: z.string().optional() }).optional() }).optional(),
})

const valueReply = z.object({
  sourceColumnOffset: gridNumber,
  summarizeFunction: z.string().optional(),
  formula: z.string().optional(),
  name: z.string().optional(),
})

type GroupReply = z.output<typeof groupReply>
type ValueReply = z.output<typeof valueReply>

/** The cell data of a tab, of which only the pivot tables are asked for. */
const gridDataReply = z.object({
  startRow: gridNumber,
  startColumn: gridNumber,
  rowData: z
    .array(
      z.object({
        values: z
          .array(
            z.object({
              pivotTable: z
                .object({
                  source: z
                    .object({
                      sheetId: gridNumber,
                      startRowIndex: gridNumber,
                      endRowIndex: gridNumber,
                      startColumnIndex: gridNumber,
                      endColumnIndex: gridNumber,
                    })
                    .optional(),
                  rows: z.array(groupReply).optional(),
                  columns: z.array(groupReply).optional(),
                  values: z.array(valueReply).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

const pivotsReply = z.object({
  sheets: z
    .array(
      z.object({ properties: z.object({ sheetId: gridNumber }).optional(), data: z.array(gridDataReply).optional() }),
    )
    .optional(),
})

type GridDataReply = z.output<typeof gridDataReply>

/** The cell data that hold the pivot tables of each tab read, by the tab's id. */
export type PivotData = Map<number, GridDataReply[]>

/**
 * Reads the cells of the tabs (`ranges`, each a tab's whole title) for the
 * pivot tables they hold, with a mask that asks for nothing else of the cells.
 */
export async function readPivotData(client: GoogleClient, id: string, ranges: readonly string[]): Promise<PivotData> {
  if (ranges.length === 0) return new Map()
  const reply = parseReply(
    pivotsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { ranges, includeGridData: true, fields: PIVOT_FIELDS },
    }),
    "the pivot tables",
  )
  return new Map((reply.sheets ?? []).map((sheet) => [sheet.properties?.sheetId ?? 0, sheet.data ?? []]))
}

/** A row or column of a pivot table as the result lists it: the source column's letter, and the part of the date it groups by. */
function groupText(entry: GroupReply, first: number): string {
  const letter = columnLetters(first + (entry.sourceColumnOffset ?? 0))
  const part = entry.groupRule?.dateTimeRule?.type
  return part === undefined ? letter : `${letter} by ${part}`
}

/** A value of a pivot table as the result lists it: its summary and its source column or its formula, and its heading when it has one. */
function valueText(entry: ValueReply, first: number): string {
  const summary = entry.summarizeFunction ?? DEFAULT_SUMMARY
  const of = entry.formula ?? `of ${columnLetters(first + (entry.sourceColumnOffset ?? 0))}`
  return `${summary} ${of}${entry.name === undefined ? "" : ` as ${JSON.stringify(entry.name)}`}`
}

/**
 * The pivot tables of a tab: where each is anchored and what it is made of,
 * row by row from the top, with the source's tab by `titleOf` (the tab's own
 * title for a source Google names no tab for).
 */
export function pivotViews(
  title: string,
  data: readonly GridDataReply[] | undefined,
  titleOf: (sheetId: number) => string | undefined,
): NonNullable<StructuredTab["pivots"]> {
  return (data ?? []).flatMap((block) =>
    (block.rowData ?? []).flatMap((row, rowPosition) =>
      (row.values ?? []).flatMap((cell, columnPosition) => {
        const pivot = cell.pivotTable
        if (pivot === undefined) return []
        const source = pivot.source ?? {}
        const first = source.startColumnIndex ?? 0
        const top = (block.startRow ?? 0) + rowPosition
        const left = (block.startColumn ?? 0) + columnPosition
        return [
          {
            at: areaLabel({
              tab: { title },
              grid: { startRowIndex: top, endRowIndex: top + 1, startColumnIndex: left, endColumnIndex: left + 1 },
            }),
            source: areaLabel({ tab: { title: titleOf(source.sheetId ?? 0) ?? title }, grid: source }),
            rows: (pivot.rows ?? []).map((entry) => groupText(entry, first)),
            columns: (pivot.columns ?? []).map((entry) => groupText(entry, first)),
            values: (pivot.values ?? []).map((entry) => valueText(entry, first)),
          },
        ]
      }),
    ),
  )
}
