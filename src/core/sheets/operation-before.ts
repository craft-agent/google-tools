import { gridRangeA1 } from "./a1"
import { readBefore, type Before } from "./before"
import type { OperationsPlan } from "./operations"

/** The cells the operations remove or replace, as read right before the write, formulas as written. */
export function readLoses(plan: OperationsPlan): Promise<Before> {
  const titles = new Map(plan.tabs.map((tab) => [tab.sheetId, tab.title]))
  const lost = plan.steps.flatMap((step) => step.lost)
  return readBefore(
    plan.client,
    plan.id,
    lost.map(({ area }) => gridRangeA1(titles.get(area.tab.sheetId) ?? area.tab.title, area.grid)),
    lost.map(({ keeps }) => keeps),
  )
}
