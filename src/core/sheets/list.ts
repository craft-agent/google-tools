import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { DEFAULT_LIST_LIMIT, type ListResult } from "./schemas"

const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet"
const LIST_ORDER = "modifiedTime desc"
const LIST_FIELDS = "nextPageToken,files(id,name,modifiedTime,webViewLink)"

const filesReply = z.object({
  nextPageToken: z.string().optional(),
  files: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        modifiedTime: z.string().optional(),
        webViewLink: z.string().optional(),
      }),
    )
    .optional(),
})

/** `value` inside a single-quoted Drive query string: `\` and `'` escaped with a backslash. */
function quoteQueryText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")
}

/** The Drive query for the user's live spreadsheets, narrowed to names that contain `query`. */
function spreadsheetQuery(query: string | undefined): string {
  const base = `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false`
  return query === undefined ? base : `${base} and name contains '${quoteQueryText(query)}'`
}

/** The spreadsheets the account can see, most recently modified first: names and dates only, never content. */
export async function listSpreadsheets(
  client: GoogleClient,
  args: { query?: string; limit?: number; page_token?: string },
): Promise<ListResult> {
  const reply = parseReply(
    filesReply,
    await client.request(SHEETS_ROUTES.files, {
      query: {
        q: spreadsheetQuery(args.query),
        orderBy: LIST_ORDER,
        pageSize: args.limit ?? DEFAULT_LIST_LIMIT,
        pageToken: args.page_token,
        fields: LIST_FIELDS,
      },
    }),
    "the spreadsheet list",
  )
  return {
    spreadsheets: (reply.files ?? []).map((file) => ({
      spreadsheet_id: file.id,
      name: file.name ?? "",
      modified_time: file.modifiedTime ?? null,
      url: file.webViewLink ?? null,
    })),
    next_page_token: reply.nextPageToken ?? null,
  }
}
