import { z } from "zod"
import type { GoogleClient } from "../google/client"
import type { DimensionRange } from "./grid"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"

const GROUPS_FIELDS = "sheets(rowGroups(range),columnGroups(range))"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const groupList = z
  .array(z.object({ range: z.object({ sheetId: gridNumber, startIndex: gridNumber, endIndex: gridNumber }) }))
  .optional()

const groupsReply = z.object({
  sheets: z.array(z.object({ rowGroups: groupList, columnGroups: groupList })).optional(),
})

type GroupReply = NonNullable<z.output<typeof groupList>>[number]

/** The row and column groups the spreadsheet has now, one entry per group (a group inside another is its own entry). */
export async function readGroups(client: GoogleClient, id: string): Promise<DimensionRange[]> {
  const reply = parseReply(
    groupsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: GROUPS_FIELDS },
    }),
    "the groups",
  )
  const rangeOf =
    (dimension: DimensionRange["dimension"]) =>
    ({ range }: GroupReply): DimensionRange => ({
      sheetId: range.sheetId ?? 0,
      dimension,
      startIndex: range.startIndex ?? 0,
      endIndex: range.endIndex ?? 0,
    })
  return (reply.sheets ?? []).flatMap((sheet) => [
    ...(sheet.rowGroups ?? []).map(rangeOf("ROWS")),
    ...(sheet.columnGroups ?? []).map(rangeOf("COLUMNS")),
  ])
}
