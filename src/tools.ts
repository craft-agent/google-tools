import type { ToolSpec } from "./core"
import { googleAccountRead } from "./core/account/read"
import { googleDriveCopy } from "./core/drive/copy"
import { googleDriveFolderCreate } from "./core/drive/folder-create"
import { googleDriveMove } from "./core/drive/move"
import { googleDriveRead } from "./core/drive/read"
import { googleDriveRename } from "./core/drive/rename"
import { googleDriveRestore } from "./core/drive/restore"
import { googleDriveTrash } from "./core/drive/trash"
import { googleDriveUpload } from "./core/drive/upload"
import { googleGmailDraftCreate } from "./core/gmail/draft-create"
import { googleGmailDraftDelete } from "./core/gmail/draft-delete"
import { googleGmailDraftEdit } from "./core/gmail/draft-edit"
import { googleGmailLabel } from "./core/gmail/label"
import { googleGmailLabelCreate } from "./core/gmail/label-create"
import { googleGmailRead } from "./core/gmail/read"
import { googleGmailSend } from "./core/gmail/send"
import { googleGmailTrash } from "./core/gmail/trash"
import { googleSheetsAdd } from "./core/sheets/add"
import { googleSheetsAppend } from "./core/sheets/append"
import { googleSheetsClear } from "./core/sheets/clear"
import { googleSheetsCreate } from "./core/sheets/create"
import { googleSheetsEdit } from "./core/sheets/edit"
import { googleSheetsFormat } from "./core/sheets/format"
import { googleSheetsProtect } from "./core/sheets/protect"
import { googleSheetsRead } from "./core/sheets/read"
import { googleSheetsRestructure } from "./core/sheets/restructure"
import { googleSheetsTabAdd } from "./core/sheets/tab-add"
import { googleSheetsTransform } from "./core/sheets/transform"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [
  googleAccountRead,
  googleSheetsRead,
  googleSheetsAppend,
  googleSheetsEdit,
  googleSheetsClear,
  googleSheetsCreate,
  googleSheetsTabAdd,
  googleSheetsFormat,
  googleSheetsAdd,
  googleSheetsRestructure,
  googleSheetsTransform,
  googleSheetsProtect,
  googleGmailRead,
  googleGmailSend,
  googleGmailDraftCreate,
  googleGmailDraftEdit,
  googleGmailDraftDelete,
  googleGmailLabel,
  googleGmailLabelCreate,
  googleGmailTrash,
  googleDriveRead,
  googleDriveUpload,
  googleDriveFolderCreate,
  googleDriveCopy,
  googleDriveRename,
  googleDriveMove,
  googleDriveTrash,
  googleDriveRestore,
]
