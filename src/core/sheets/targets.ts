import { isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import type { SheetTab } from "./tabs"

/** The target `<label>/spreadsheets/<spreadsheet_id>/sheets/<sheet_id>` of a tab. */
export function sheetTarget(label: string, spreadsheetId: string, sheetId: number): string {
  return `${label}/spreadsheets/${spreadsheetId}/sheets/${sheetId}`
}

/** The target `<label>/spreadsheets/<spreadsheet_id>` of a spreadsheet, for a write that adds to it a tab or the spreadsheet itself. */
export function spreadsheetTarget(label: string, spreadsheetId: string): string {
  return `${label}/spreadsheets/${spreadsheetId}`
}

/**
 * What a write that adds to a spreadsheet resolves to: the target of the
 * spreadsheet `plan` names, or `*` when the plan cannot be made. A
 * cancellation is rethrown.
 */
export async function resolveSpreadsheetTargets(
  ctx: ToolContext,
  plan: () => Promise<{ label: string; id: string }>,
): Promise<string[]> {
  try {
    const { label, id } = await plan()
    return [spreadsheetTarget(label, id)]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}

/**
 * What a write to the tabs `plan` resolves writes to: one target per distinct
 * tab, sorted, or `*` when the plan cannot be made (an unknown tab, no label,
 * Google failing). A cancellation is rethrown.
 */
export async function resolveSheetTargets(
  ctx: ToolContext,
  plan: () => Promise<{ label: string; id: string; written: readonly SheetTab[] }>,
): Promise<string[]> {
  try {
    const { label, id, written } = await plan()
    return [...new Set(written.map((tab) => sheetTarget(label, id, tab.sheetId)))].sort()
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
