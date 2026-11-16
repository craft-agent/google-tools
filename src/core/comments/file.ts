import { SUPPORTS_ALL_DRIVES, fileReply } from "../drive/file-view"
import { kindOf, SPREADSHEET_MIME_TYPE, type FileKind } from "../drive/kinds"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { COMMENTS_ROUTES } from "./routes"

const FILE_FIELDS = "id,name,mimeType,webViewLink,shortcutDetails"

const commentFileReply = fileReply.pick({
  id: true,
  name: true,
  mimeType: true,
  webViewLink: true,
  shortcutDetails: true,
})

/** The file whose comments are read. */
export type CommentFile = {
  fileId: string
  name: string
  kind: FileKind
  webViewLink: string | null
  /** Whether its comments are the spreadsheet's own, anchored to cells. */
  isSpreadsheet: boolean
}

/**
 * The file `fileId` names. A folder takes no comments and a shortcut has none
 * of its own, so both are `invalid_argument`, the shortcut naming its target.
 */
export async function readCommentFile(client: GoogleClient, fileId: string): Promise<CommentFile> {
  const file = parseReply(
    commentFileReply,
    await client.request(COMMENTS_ROUTES.file, {
      params: { file_id: fileId },
      query: { ...SUPPORTS_ALL_DRIVES, fields: FILE_FIELDS },
    }),
    "a file",
  )
  const mimeType = file.mimeType ?? ""
  const kind = kindOf(mimeType)
  if (kind === "folder") throw new ToolError("invalid_argument", "A folder takes no comments.")
  if (kind === "shortcut") {
    const target = file.shortcutDetails?.targetId
    throw new ToolError(
      "invalid_argument",
      target === undefined
        ? "A shortcut has no comments of its own; read the comments of its target."
        : `A shortcut has no comments of its own; read the comments of its target, ${target}.`,
    )
  }
  return {
    fileId: file.id,
    name: file.name ?? "",
    kind,
    webViewLink: file.webViewLink ?? null,
    isSpreadsheet: mimeType === SPREADSHEET_MIME_TYPE,
  }
}
