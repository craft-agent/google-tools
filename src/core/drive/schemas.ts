import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { FILE_KINDS } from "./kinds"

/** The methods of the Drive read. */
export const DRIVE_METHODS = ["search", "file", "drives", "download"] as const

/** What `search` returns when `limit` is left out, what `drives` returns, and the most either returns. */
export const DEFAULT_SEARCH_LIMIT = 20
export const DEFAULT_DRIVES_LIMIT = 50
export const MAX_LIMIT = 100

/** The most characters of a query, a media type and a file name. */
export const MAX_QUERY_LENGTH = 2000
export const MAX_MIME_TYPE_LENGTH = 200
export const MAX_NAME_LENGTH = 200

/** The most GiB, and so bytes, of a file that `download` saves. */
export const MAX_DOWNLOAD_GIB = 2
export const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_GIB * 1024 * 1024 * 1024

/** The largest file Google exports, in MB; a larger one is refused by Google. */
export const MAX_EXPORT_MB = 10

/** The most pages of permissions `file` reads, and how many a page holds. */
export const MAX_PERMISSION_PAGES = 10
export const PERMISSIONS_PAGE_SIZE = 100

/** The sharing of a folder: only the account can reach it, or others can. */
export const REACHABILITY = ["only_you", "shared"] as const

/** Who a permission is for. */
export const PERMISSION_TYPES = ["user", "group", "domain", "anyone"] as const

export const driveReadInput = z.strictObject({
  method: z.enum(DRIVE_METHODS),
  account: accountArg,
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe(
      "search: words to find in the names and contents of files (full text), taken as written; for exact conditions use `raw_query`. drives: a shared-drive query such as `name contains 'Design'`; left out, every shared drive.",
    ),
  raw_query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe(
      "search: a Drive query passed as written (`name contains 'budget' and modifiedTime > '2026-01-01T00:00:00'`), never with `query`; trashed files are then included unless `trashed` says otherwise.",
    ),
  folder: z
    .string()
    .optional()
    .describe("search: only files directly inside this folder: its id, or `root` for the top of My Drive."),
  mime_type: z
    .string()
    .min(1)
    .max(MAX_MIME_TYPE_LENGTH)
    .optional()
    .describe(
      "search: only files of this media type (`application/pdf`; `application/vnd.google-apps.folder` finds folders).",
    ),
  drive_id: z
    .string()
    .optional()
    .describe(
      "search: search only this shared drive, by the `drive_id` that method `drives` gave; left out, every drive.",
    ),
  trashed: z
    .boolean()
    .optional()
    .describe("search: `true` finds only files in the trash, `false` only files outside it (default false)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `search, drives: how many to return (1 to ${MAX_LIMIT}; default ${DEFAULT_SEARCH_LIMIT} for search and ${DEFAULT_DRIVES_LIMIT} for drives).`,
    ),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe("search, drives: the `next_page_token` of the previous call, for the next page."),
  file_id: z.string().optional().describe("file, download: the id a `search` result gave as `file_id`."),
  export_type: z
    .string()
    .min(1)
    .max(MAX_MIME_TYPE_LENGTH)
    .optional()
    .describe(
      "download: for a Google Docs, Sheets, Slides, Drawings or Apps Script file, the format to export, as a media type or one of `pdf`, `docx`, `xlsx`, `pptx`, `csv`, `tsv`, `txt`, `html`, `png`, `jpeg`, `svg`, `odt`, `ods`, `odp`, `rtf`, `epub`, `md`, `zip` (HTML, zipped) and `json` (Apps Script); each kind takes only some of them, and `csv` and `tsv` hold the first sheet only. Left out, a Doc or a Slides file is exported as PDF, a Sheet as xlsx, a Drawing as PNG and a script as json.",
    ),
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .optional()
    .describe(
      "download: what to name the saved file, without its extension (which follows the content); left out, the file's own name.",
    ),
})

const fileViewShape = {
  file_id: z.string(),
  name: z.string(),
  mime_type: z.string(),
  kind: z.enum(FILE_KINDS),
  /** In bytes; left out for the files of the Google editors, which have none. */
  size: z.number().int().optional(),
  modified_time: z.string().nullable(),
  created_time: z.string().nullable(),
  parents: z.array(z.string()),
  /** The id of the shared drive the file is in; `null` in My Drive. */
  drive_id: z.string().nullable(),
  owners: z.array(z.string()),
  shared: z.boolean(),
  trashed: z.boolean(),
  web_view_link: z.string().nullable(),
  starred: z.boolean(),
  md5: z.string().optional(),
  /** What a shortcut points to. */
  shortcut_target: z.object({ file_id: z.string(), mime_type: z.string() }).optional(),
}

export const fileViewSchema = z.object(fileViewShape)

export const capabilitiesSchema = z.object({
  can_edit: z.boolean(),
  can_share: z.boolean(),
  can_trash: z.boolean(),
  can_download: z.boolean(),
})

export const accessEntrySchema = z.object({
  type: z.enum(PERMISSION_TYPES),
  role: z.string(),
  email: z.string().optional(),
  domain: z.string().optional(),
  name: z.string().optional(),
  /** For `anyone` and `domain`: whether the file shows up in a search, not only for those who have the link. */
  discoverable: z.boolean().optional(),
  /** Whether the access comes from a folder above rather than from this file. */
  inherited: z.boolean().optional(),
  inherited_from: z.string().optional(),
})

export const driveSchema = z.object({
  drive_id: z.string(),
  name: z.string(),
  created_time: z.string().optional(),
})

const searchOutput = {
  files: z.array(fileViewSchema),
  next_page_token: z.string().nullable(),
  /** `true` when Drive did not search every file, so the result may miss some. */
  incomplete_search: z.boolean(),
}

const fileOutput = {
  description: z.string().nullable(),
  capabilities: capabilitiesSchema,
  /** Who can reach the file; `null` when Google shows the sharing only to people who can share it. */
  access: z.array(accessEntrySchema).nullable(),
  /** Says why `access` is `null` or short. */
  access_note: z.string().optional(),
  /** For a folder only: whether only the account can reach it or others can. */
  reachable: z.enum(REACHABILITY).optional(),
}

const drivesOutput = {
  drives: z.array(driveSchema),
}

const downloadOutput = {
  /** Whether the content is an export of a Google editors' file rather than the file's own bytes. */
  exported: z.boolean(),
  /** Where the content was saved. */
  path: z.string(),
}

/** One object for all four methods, each filling its own keys; `mime_type` and `size` of a download are those of the saved content. */
export const driveReadOutput = z
  .object({
    ...fileViewShape,
    ...searchOutput,
    ...fileOutput,
    ...drivesOutput,
    ...downloadOutput,
  })
  .partial()

export type DriveReadArgs = z.output<typeof driveReadInput>
export type DriveMethod = (typeof DRIVE_METHODS)[number]
export type FileView = z.infer<typeof fileViewSchema>
export type Capabilities = z.infer<typeof capabilitiesSchema>
export type AccessEntry = z.infer<typeof accessEntrySchema>
export type DriveSummary = z.infer<typeof driveSchema>
export type SearchResult = z.infer<z.ZodObject<typeof searchOutput>>
export type FileResult = FileView & z.infer<z.ZodObject<typeof fileOutput>>
export type DrivesResult = { drives: DriveSummary[]; next_page_token: string | null }
export type DownloadResult = Pick<FileView, "file_id" | "name" | "mime_type"> &
  z.infer<z.ZodObject<typeof downloadOutput>> & { size: number }
