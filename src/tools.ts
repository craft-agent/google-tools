import type { ToolSpec } from "./core"
import { googleAccountRead } from "./core/account/read"
import { googleSheetsAppend } from "./core/sheets/append"
import { googleSheetsClear } from "./core/sheets/clear"
import { googleSheetsCreate } from "./core/sheets/create"
import { googleSheetsEdit } from "./core/sheets/edit"
import { googleSheetsFormat } from "./core/sheets/format"
import { googleSheetsRead } from "./core/sheets/read"
import { googleSheetsTabAdd } from "./core/sheets/tab-add"

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
]
