import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { fetchFile, fileReply, type FileReply } from "./file-view"
import { kindOf, type FileKind } from "./kinds"

/** The fields beside the view's that a write reads of the item it changes. */
const ITEM_FIELDS = "version,capabilities(canCopy)"

const itemReply = fileReply.extend({
  version: z.string().optional(),
  capabilities: z.object({ canCopy: z.boolean().optional() }).optional(),
})

/** A file or folder as a write plans it: its view, its `version` (which changes whenever the item does) and whether the account may copy it. */
export type DriveItem = z.output<typeof itemReply>

/** The file or folder `fileId` names, as Google holds it now. */
export function readItem(client: GoogleClient, fileId: string): Promise<DriveItem> {
  return fetchFile(client, fileId, itemReply, ITEM_FIELDS)
}

/** The kind of the item, as a result names one. */
export function itemKind(item: Pick<FileReply, "mimeType">): FileKind {
  return kindOf(item.mimeType ?? "")
}

/** The item as a file or folder Google just made or changed, each field optional since the change happened whatever the answer lacks. */
export function madeItem(reply: unknown): Partial<FileReply> {
  const parsed = fileReply.partial().safeParse(reply)
  return parsed.success ? parsed.data : {}
}
