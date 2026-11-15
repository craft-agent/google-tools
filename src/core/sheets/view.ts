import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { gridRangeA1 } from "./a1"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { ViewResult, ViewedTab } from "./schemas"

const VIEW_FIELDS =
  "spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone)," +
  "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),tables(tableId,name,range))"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const spreadsheetReply = z.object({
  spreadsheetUrl: z.string().optional(),
  properties: z
    .object({ title: z.string().optional(), locale: z.string().optional(), timeZone: z.string().optional() })
    .optional(),
  sheets: z
    .array(
      z.object({
        properties: z
          .object({
            sheetId: gridNumber,
            title: z.string().optional(),
            index: gridNumber,
            hidden: z.boolean().optional(),
            gridProperties: z
              .object({
                rowCount: gridNumber,
                columnCount: gridNumber,
                frozenRowCount: gridNumber,
                frozenColumnCount: gridNumber,
              })
              .optional(),
          })
          .optional(),
        tables: z
          .array(
            z.object({
              tableId: z.string().optional(),
              name: z.string().optional(),
              range: z
                .object({
                  startRowIndex: gridNumber,
                  endRowIndex: gridNumber,
                  startColumnIndex: gridNumber,
                  endColumnIndex: gridNumber,
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

type SheetReply = NonNullable<z.output<typeof spreadsheetReply>["sheets"]>[number]

function viewedTab(sheet: SheetReply): ViewedTab {
  const properties = sheet.properties ?? {}
  const grid = properties.gridProperties ?? {}
  const title = properties.title ?? ""
  return {
    sheet_id: properties.sheetId ?? 0,
    title,
    index: properties.index ?? 0,
    hidden: properties.hidden ?? false,
    row_count: grid.rowCount ?? 0,
    column_count: grid.columnCount ?? 0,
    frozen_rows: grid.frozenRowCount ?? 0,
    frozen_columns: grid.frozenColumnCount ?? 0,
    tables: (sheet.tables ?? []).map((table) => ({
      table_id: table.tableId ?? "",
      name: table.name ?? "",
      range: gridRangeA1(title, table.range),
    })),
  }
}

/** The structure of a spreadsheet: its title, locale and time zone, and each tab's size, frozen panes and tables; no cell values. */
export async function viewSpreadsheet(client: GoogleClient, id: string): Promise<ViewResult> {
  const reply = parseReply(
    spreadsheetReply,
    await client.request(SHEETS_ROUTES.spreadsheet, { params: { spreadsheet_id: id }, query: { fields: VIEW_FIELDS } }),
    "the spreadsheet",
  )
  return {
    spreadsheet_id: id,
    title: reply.properties?.title ?? "",
    url: reply.spreadsheetUrl ?? null,
    locale: reply.properties?.locale ?? null,
    time_zone: reply.properties?.timeZone ?? null,
    tabs: (reply.sheets ?? []).map(viewedTab),
  }
}
