import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { isGoogleFile, kindOf } from "./kinds"
import { DRIVE_ROUTES } from "./routes"
import type { FileView } from "./schemas"

/** The fields of a file that every view shows. */
export const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,parents,driveId,owners(emailAddress),shared,trashed,webViewLink,starred,md5Checksum,shortcutDetails"

/** The query of every call that reads a file or lists them: shared drives are searched and read like My Drive. */
export const SUPPORTS_ALL_DRIVES = { supportsAllDrives: true } as const

export const fileReply = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  /** Drive writes a size as a string of digits. */
  size: z.string().optional(),
  modifiedTime: z.string().optional(),
  createdTime: z.string().optional(),
  parents: z.array(z.string()).optional(),
  driveId: z.string().optional(),
  owners: z.array(z.object({ emailAddress: z.string().optional() })).optional(),
  shared: z.boolean().optional(),
  trashed: z.boolean().optional(),
  webViewLink: z.string().optional(),
  starred: z.boolean().optional(),
  md5Checksum: z.string().optional(),
  shortcutDetails: z.object({ targetId: z.string().optional(), targetMimeType: z.string().optional() }).optional(),
})

export type FileReply = z.output<typeof fileReply>

/** `files.get` for `fileId`, asking for `FILE_FIELDS` and the `extraFields` given. */
export async function fetchFile<S extends z.ZodType>(
  client: GoogleClient,
  fileId: string,
  schema: S,
  extraFields = "",
): Promise<z.output<S>> {
  return parseReply(
    schema,
    await client.request(DRIVE_ROUTES.file, {
      params: { file_id: fileId },
      query: { ...SUPPORTS_ALL_DRIVES, fields: extraFields === "" ? FILE_FIELDS : `${FILE_FIELDS},${extraFields}` },
    }),
    "a file",
  )
}

/** The size Drive wrote, in bytes; `undefined` when it wrote none or not a whole number. */
export function sizeOf(file: Pick<FileReply, "size">): number | undefined {
  if (file.size === undefined) return undefined
  const size = Number(file.size)
  return Number.isSafeInteger(size) ? size : undefined
}

/** The view of a file that a search and a file read both show. */
export function fileView(file: FileReply): FileView {
  const mimeType = file.mimeType ?? ""
  const kind = kindOf(mimeType)
  const size = isGoogleFile(kind) ? undefined : sizeOf(file)
  const target = file.shortcutDetails
  return {
    file_id: file.id,
    name: file.name ?? "",
    mime_type: mimeType,
    kind,
    ...(size !== undefined && { size }),
    modified_time: file.modifiedTime ?? null,
    created_time: file.createdTime ?? null,
    parents: file.parents ?? [],
    drive_id: file.driveId ?? null,
    owners: (file.owners ?? []).flatMap((owner) => owner.emailAddress ?? []),
    shared: file.shared ?? false,
    trashed: file.trashed ?? false,
    web_view_link: file.webViewLink ?? null,
    starred: file.starred ?? false,
    ...(file.md5Checksum !== undefined && { md5: file.md5Checksum }),
    ...(kind === "shortcut" &&
      target?.targetId !== undefined && {
        shortcut_target: { file_id: target.targetId, mime_type: target.targetMimeType ?? "" },
      }),
  }
}
