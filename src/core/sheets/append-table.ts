import { ToolError } from "../errors"
import type { Cell } from "./schemas"
import { listNames, type SheetTab, type SheetTable } from "./tabs"

/** A native table with the tab it is in. */
export type TableMatch = { tab: SheetTab; table: SheetTable }

/** What Google takes for one cell of `appendCells`: a typed value, or nothing for a cell left empty. */
export type CellData = {
  userEnteredValue?:
    { boolValue: boolean } | { numberValue: number } | { formulaValue: string } | { stringValue: string }
}

/**
 * The one table a call means: the one with that id, else the one with that
 * name, else the one whose name matches ignoring case. None, or several that
 * match at the same step, is `invalid_argument` listing the tables' names.
 */
export function findTable(tabs: readonly SheetTab[], key: string): TableMatch {
  const all = tabs.flatMap((tab) => tab.tables.map((table) => ({ tab, table })))
  const lowered = key.toLowerCase()
  const steps = [
    all.filter(({ table }) => table.tableId === key),
    all.filter(({ table }) => table.name === key),
    all.filter(({ table }) => table.name.toLowerCase() === lowered),
  ]
  const matches = steps.find((step) => step.length > 0) ?? []
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new ToolError(
      "invalid_argument",
      `${matches.length === 0 ? "No table matches" : "Several tables match"} ${JSON.stringify(key)}; the spreadsheet's tables are: ${listNames(all.map(({ table }) => table.name))}. Give a table's id or its exact name.`,
    )
  }
  return match
}

/** How many columns the table covers. */
export function tableWidth({ range }: SheetTable): number {
  return (range.endColumnIndex ?? 0) - (range.startColumnIndex ?? 0)
}

/**
 * One cell for `appendCells`, which does no typing of its own as the sheet's
 * editor does: numbers and booleans keep their type, `=…` is a formula unless
 * `raw`, and any other text (a date included) stays text. `null` and `""` leave
 * the cell empty.
 */
export function cellData(value: Cell, raw: boolean | undefined): CellData {
  if (value === null || value === "") return {}
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } }
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } }
  return {
    userEnteredValue: value.startsWith("=") && raw !== true ? { formulaValue: value } : { stringValue: value },
  }
}
