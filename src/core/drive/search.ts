import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { FILE_FIELDS, SUPPORTS_ALL_DRIVES, fileReply, fileView } from "./file-view"
import { driveId, folderId } from "./ids"
import { DRIVE_ROUTES } from "./routes"
import { DEFAULT_SEARCH_LIMIT, type DriveReadArgs, type SearchResult } from "./schemas"

type SearchArgs = Pick<
  DriveReadArgs,
  "query" | "raw_query" | "folder" | "mime_type" | "drive_id" | "trashed" | "limit" | "page_token"
>

/** How a search lists the newest changes first; Drive cannot sort the results of a full-text search. */
const NEWEST_FIRST = "modifiedTime desc"

const FULL_TEXT_PATTERN = /\bfullText\b/

const listReply = z.object({
  files: z.array(fileReply).optional(),
  nextPageToken: z.string().optional(),
  incompleteSearch: z.boolean().optional(),
})

/** `text` as a Drive query writes it inside single quotes: the backslash and the quote escaped. */
export function quoted(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

/** The query a search sends, and whether it is a full-text one, which Drive cannot sort. */
function buildQuery(args: SearchArgs): { q: string; fullText: boolean } {
  if (args.query !== undefined && args.raw_query !== undefined) {
    throw new ToolError("invalid_argument", "Give `query` or `raw_query`, not both.")
  }
  const clauses: string[] = []
  if (args.query !== undefined) clauses.push(`fullText contains ${quoted(args.query)}`)
  if (args.folder !== undefined) clauses.push(`'${folderId(args.folder)}' in parents`)
  if (args.mime_type !== undefined) clauses.push(`mimeType = ${quoted(args.mime_type)}`)
  if (args.trashed !== undefined || args.raw_query === undefined) clauses.push(`trashed = ${args.trashed ?? false}`)
  if (args.raw_query === undefined) return { q: clauses.join(" and "), fullText: args.query !== undefined }
  const raw = clauses.length === 0 ? args.raw_query : `(${args.raw_query}) and ${clauses.join(" and ")}`
  return { q: raw, fullText: FULL_TEXT_PATTERN.test(args.raw_query) }
}

/**
 * The files that match the arguments, newest change first unless the search
 * is full text, in My Drive and every shared drive or in the one `drive_id`
 * names. `query` and `raw_query` are exclusive; without `raw_query`, trashed
 * files are left out unless `trashed` says otherwise.
 */
export async function searchFiles(client: GoogleClient, args: SearchArgs): Promise<SearchResult> {
  const { q, fullText } = buildQuery(args)
  const listed = parseReply(
    listReply,
    await client.request(DRIVE_ROUTES.files, {
      query: {
        ...SUPPORTS_ALL_DRIVES,
        includeItemsFromAllDrives: true,
        ...(args.drive_id === undefined
          ? { corpora: "allDrives" }
          : { corpora: "drive", driveId: driveId(args.drive_id, "shared drive id") }),
        q,
        orderBy: fullText ? undefined : NEWEST_FIRST,
        pageSize: args.limit ?? DEFAULT_SEARCH_LIMIT,
        pageToken: args.page_token,
        fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
      },
    }),
    "the file list",
  )
  return {
    files: (listed.files ?? []).map(fileView),
    next_page_token: listed.nextPageToken ?? null,
    incomplete_search: listed.incompleteSearch ?? false,
  }
}
