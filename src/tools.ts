import type { ToolSpec } from "./core"
import { googleAccountRead } from "./core/account/read"
import { googleSheetsRead } from "./core/sheets/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [googleAccountRead, googleSheetsRead]
