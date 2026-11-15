import type { z } from "zod"
import { ToolError } from "../errors"
import type { Route } from "../google/routes"
import type { ToolContext } from "../tool"
import { readGroups } from "./groups"
import type { DimensionRange } from "./grid"
import { openSpreadsheet, type OpenSpreadsheet, type SheetTab } from "./tabs"

/** One request of a `spreadsheets.batchUpdate`: the single-key object Google takes. */
export type SheetsRequest = Record<string, unknown>

/** What an operation reads beyond the tabs: the groups of rows and columns the spreadsheet has now. */
export type OperationNeed = "groups"

/**
 * What the operations of a call are built from: the tabs as Google reports
 * them, and the state the operations move as they are built in order, so a
 * later operation plans on what an earlier one will have done.
 */
export type OperationContext = {
  tabs: readonly SheetTab[]
  /** The ids of the tabs from left to right. */
  order: number[]
  /** The groups of rows and columns, filled only when an operation `needs` them. */
  groups: DimensionRange[]
}

/**
 * One operation of a vocabulary: the schema of its arguments, whose `op` is
 * the operation's name, and what the call does with a validated operation.
 * The three functions plan on the same context, so a description cannot
 * promise what the requests would not do; each refuses a call that cannot be
 * carried out as `invalid_argument`.
 */
export type OperationSpec<S extends z.ZodObject<any> = z.ZodObject<any>> = {
  schema: S
  needs?: readonly OperationNeed[]
  /** The Google requests that carry the operation out, in the order they must run. They move `context`. */
  requests(op: z.output<S>, context: OperationContext): SheetsRequest[]
  /** The tabs the operation changes. */
  tabs(op: z.output<S>, context: OperationContext): SheetTab[]
  /** The operation as one short line of the approval prompt, in the tool's fixed words with the call's values quoted. */
  describe(op: z.output<S>, context: OperationContext): string
}

/** A vocabulary of operations, by the `op` that names each. */
export type OperationTable = Readonly<Record<string, OperationSpec>>

/** One operation planned: its requests, the tabs it changes and its line. */
export type PlannedOperation = { requests: SheetsRequest[]; tabs: SheetTab[]; line: string }

/** What a call of operations works with: the open spreadsheet, each operation planned, and the whole call's requests, lines and changed tabs. */
export type OperationsPlan = OpenSpreadsheet & {
  steps: PlannedOperation[]
  requests: SheetsRequest[]
  lines: string[]
  /** The tabs the operations change, each once, in the order of their positions. */
  written: SheetTab[]
}

/** Returns the spec as it is, so its schema's type reaches the functions. */
export function defineOperation<S extends z.ZodObject<any>>(spec: OperationSpec<S>): OperationSpec<S> {
  return spec
}

function specOf(table: OperationTable, op: string): OperationSpec {
  const spec = Object.hasOwn(table, op) ? table[op] : undefined
  if (spec === undefined) {
    throw new ToolError(
      "invalid_argument",
      `The operation ${JSON.stringify(op)} is not offered; the operations are: ${Object.keys(table).join(", ")}.`,
    )
  }
  return spec
}

/**
 * Opens the spreadsheet for the `write` route and plans every operation, in
 * order, on the tabs Google reports now: each operation's requests, tabs and
 * line. Describing, targeting and running a call all plan with this, so a range
 * on a tab the spreadsheet lacks, or a block where whole rows are needed,
 * refuses the call before it writes.
 */
export async function planOperations(
  table: OperationTable,
  args: { account?: string; spreadsheet: string; operations: readonly { op: string }[] },
  ctx: ToolContext,
  write: Route,
): Promise<OperationsPlan> {
  const open = await openSpreadsheet(args, ctx, write)
  const specs = args.operations.map(({ op }) => specOf(table, op))
  const needsGroups = specs.some((spec) => spec.needs?.includes("groups"))
  const context: OperationContext = {
    tabs: open.tabs,
    order: open.tabs.map((tab) => tab.sheetId),
    groups: needsGroups ? await readGroups(open.client, open.id) : [],
  }
  const steps = args.operations.map((op, position): PlannedOperation => {
    const spec = specs[position]!
    return {
      tabs: spec.tabs(op, context),
      line: spec.describe(op, context),
      requests: spec.requests(op, context),
    }
  })
  const changed = new Set(steps.flatMap((step) => step.tabs.map((tab) => tab.sheetId)))
  return {
    ...open,
    steps,
    requests: steps.flatMap((step) => step.requests),
    lines: steps.map((step) => step.line),
    written: open.tabs.filter((tab) => changed.has(tab.sheetId)),
  }
}
