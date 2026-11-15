import type { Route } from "../google/routes"
import type { CallDescription, CallHeadline, CallText, ToolContext } from "../tool"
import { readBefore, type Before } from "./before"
import { checkExpect, type Guard } from "./expect"
import { openSpreadsheet, tabOfRange, type OpenSpreadsheet, type SheetTab } from "./tabs"
import { cellsFact, checksFact, overwritesFact, tabsFact } from "./write-describe"

/** What a write that replaces the cells of ranges works with: the open spreadsheet, the ranges, and the tab each one lies in. */
export type OverwritePlan = OpenSpreadsheet & { ranges: string[]; written: SheetTab[] }

/** The part of a description an overwrite chooses; the facts that every overwrite shows and the pin are added. */
export type OverwriteShown = { headline: CallHeadline; text: CallText; cells?: number }

/** Opens the spreadsheet for the `write` route and finds the tab of each range, refusing a range whose tab does not exist. */
export async function planOverwrite(
  args: { account?: string; spreadsheet: string },
  ctx: ToolContext,
  write: Route,
  ranges: string[],
): Promise<OverwritePlan> {
  const open = await openSpreadsheet(args, ctx, write)
  return { ...open, ranges, written: ranges.map((range) => tabOfRange(open.tabs, range)) }
}

/** What the call replaces, read right before the write and after the expected cells were checked, so a stale call writes nothing. */
export async function readGuardedBefore(plan: OverwritePlan, expect: readonly Guard[] | undefined): Promise<Before> {
  if (expect !== undefined) await checkExpect(plan, expect)
  return readBefore(plan.client, plan.id, plan.ranges)
}

/**
 * The description of an overwrite: the headline and text it chose, the facts
 * every overwrite shows (how many filled cells it replaces, how many cells it
 * checks, the tabs, and the cells it writes where it writes any) and a pin of
 * the values now in its ranges, so a change after the prompt fails as `stale`.
 */
export async function describeOverwrite(
  plan: OverwritePlan,
  checks: number,
  { headline, text, cells }: OverwriteShown,
): Promise<CallDescription> {
  const before = await readBefore(plan.client, plan.id, plan.ranges)
  return {
    headline,
    facts: [
      overwritesFact(before.occupied),
      checksFact(checks),
      tabsFact(plan.written),
      ...(cells === undefined ? [] : [cellsFact(cells)]),
    ],
    text,
    pins: { values: before.digest },
  }
}
