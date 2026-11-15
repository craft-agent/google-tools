import type { ToolSpec } from "./core"
import { googleAccountRead } from "./core/account/read"
import { googleSheetsAppend } from "./core/sheets/append"
import { googleSheetsClear } from "./core/sheets/clear"
import { googleSheetsEdit } from "./core/sheets/edit"
import { googleSheetsRead } from "./core/sheets/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [
  googleAccountRead,
  googleSheetsRead,
  googleSheetsAppend,
  googleSheetsEdit,
  googleSheetsClear,
]
