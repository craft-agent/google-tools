import type { CallFact } from "../tool"
import type { Cell } from "./schemas"
import type { SheetTab } from "./tabs"
import { SHEETS_WORDS } from "./words"

const CELL_SEPARATOR = "\t"

/** A count under `label`, as the singular template for one and the plural for any other number. */
function countFact(label: string, count: number, one: string, many: string): CallFact {
  return { label, value: { text: count === 1 ? one : many, values: { count } } }
}

/** The `Rows` fact: how many rows the call writes. */
export function rowsFact(count: number): CallFact {
  return countFact(SHEETS_WORDS.rows, count, SHEETS_WORDS.rowCount, SHEETS_WORDS.rowsCount)
}

/** The `Cells` fact: how many cells the call writes. */
export function cellsFact(count: number): CallFact {
  return countFact(SHEETS_WORDS.cells, count, SHEETS_WORDS.cellCount, SHEETS_WORDS.cellsCount)
}

/** The `Overwrites` fact: how many cells that hold something now are in the ranges the call replaces. */
export function overwritesFact(count: number): CallFact {
  return countFact(SHEETS_WORDS.overwrites, count, SHEETS_WORDS.cellCount, SHEETS_WORDS.cellsCount)
}

/** The `Checks` fact: how many cells the call expects to show certain values, or `none`. */
export function checksFact(count: number): CallFact {
  if (count === 0) return { label: SHEETS_WORDS.checks, value: { text: SHEETS_WORDS.none } }
  return countFact(SHEETS_WORDS.checks, count, SHEETS_WORDS.checkCount, SHEETS_WORDS.checksCount)
}

/** The `Operations` fact: how many operations the call carries. */
export function operationsFact(count: number): CallFact {
  return countFact(SHEETS_WORDS.operations, count, SHEETS_WORDS.operationCount, SHEETS_WORDS.operationsCount)
}

/** The `Ranges` fact: how many ranges the call's operations name. */
export function rangesFact(count: number): CallFact {
  return countFact(SHEETS_WORDS.ranges, count, SHEETS_WORDS.rangeCount, SHEETS_WORDS.rangesCount)
}

/** The `Tabs` fact: the titles Google reports for the tabs the call writes to, each once, in the order of the tabs. */
export function tabsFact(tabs: readonly SheetTab[]): CallFact {
  const distinct = [...new Map(tabs.map((tab) => [tab.sheetId, tab])).values()].sort((a, b) => a.index - b.index)
  return { label: SHEETS_WORDS.tabs, value: distinct.map((tab) => tab.title).join(", ") }
}

/** A cell as the text of a call shows it: as written, nothing for `null`. */
function cellText(cell: Cell): string {
  return cell === null ? "" : String(cell)
}

/** The rows as the call writes them: one line per row, the cells separated by a tab. */
export function rowsText(rows: readonly (readonly Cell[])[]): string {
  return rows.map((row) => row.map(cellText).join(CELL_SEPARATOR)).join("\n")
}
