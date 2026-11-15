import type { z } from "zod"
import { isRecord } from "../describe"
import { ToolError } from "../errors"
import type { Route } from "../google/routes"
import type { ToolContext } from "../tool"
import type { Keeps } from "./before"
import { readCharts, type ChartState } from "./charts"
import { readGroups } from "./groups"
import type { DimensionRange, ResolvedRange } from "./grid"
import { noObjects, readObjects, type SheetObjects } from "./objects"
import { readCells, type CellsRead, type CellsWanted } from "./operation-reads"
import { openSpreadsheet, type OpenSpreadsheet, type SheetTab } from "./tabs"

/** How much of an unknown `op` an error repeats. */
const MAX_SHOWN_OP_LENGTH = 40

/** One request of a `spreadsheets.batchUpdate`: the single-key object Google takes. */
export type SheetsRequest = Record<string, unknown>

/** What an operation reads beyond the tabs: the groups of rows and columns, the tables, conditional rules, filters and filter views, or the charts, the spreadsheet has now. */
export type OperationNeed = "groups" | "objects" | "charts"

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
  /** The tables, rules, filters and filter views, filled only when an operation `needs` them. */
  objects: SheetObjects
  /** The charts, filled only when an operation `needs` them. */
  charts: ChartState[]
  /** The titles of the tabs earlier operations create, which Google has not reported yet. */
  created: string[]
  /** The ids of the tabs earlier operations create under an id of their own, which Google has not reported yet. */
  newIds: number[]
  /** What each operation that asked (`reads`) had read from the cells, by the operation. */
  read: WeakMap<object, CellsRead>
}

/** Cells an operation removes or replaces: the range they lie in, and which of its cells stay as they are. */
export type LostCells = { area: ResolvedRange; keeps?: Keeps }

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
  /** The operation moves cells, so a range of a later operation on its tab would mean other cells than the ones the call names. */
  shifts?: true
  /** The operation changes the spreadsheet itself (its title, its settings, a new tab) rather than the cells or properties of a tab. */
  onSpreadsheet?: true
  /** What the operation has read from the cells before it is planned; the result is in `context.read` for the operation. */
  reads?(op: z.output<S>, context: OperationContext): CellsWanted
  /** The Google requests that carry the operation out, in the order they must run. They move `context`. */
  requests(op: z.output<S>, context: OperationContext): SheetsRequest[]
  /** The tabs the operation changes. */
  tabs(op: z.output<S>, context: OperationContext): SheetTab[]
  /** The operation as one short line of the approval prompt, in the tool's fixed words with the call's values quoted. */
  describe(op: z.output<S>, context: OperationContext): string
  /** The cells whose values the operation removes or replaces; none for an operation that loses no value. */
  loses?(op: z.output<S>, context: OperationContext): LostCells[]
  /** The tabs the operation renames or deletes, whose titles the approval pins. */
  retitles?(op: z.output<S>, context: OperationContext): SheetTab[]
  /** The objects the operation changes or deletes, as Google reports them now, which the approval pins. */
  pins?(op: z.output<S>, context: OperationContext): unknown[]
}

/** A vocabulary of operations, by the `op` that names each. */
export type OperationTable = Readonly<Record<string, OperationSpec>>

/** One operation planned: its name, requests, the tabs it changes and its line, the cells it loses, the tabs it renames or deletes, the objects it changes or deletes, and whether it shifts cells. */
export type PlannedOperation = {
  name: string
  requests: SheetsRequest[]
  tabs: SheetTab[]
  line: string
  lost: LostCells[]
  retitled: SheetTab[]
  pinned: unknown[]
  shifts: boolean
}

/** What a call of operations works with: the open spreadsheet, each operation planned, and the whole call's requests, lines and changed tabs. */
export type OperationsPlan = OpenSpreadsheet & {
  steps: PlannedOperation[]
  requests: SheetsRequest[]
  lines: string[]
  /** The tabs the operations change, each once, in the order of their positions. */
  written: SheetTab[]
  /** Whether an operation changes the spreadsheet itself. */
  onSpreadsheet: boolean
}

/** Returns the spec as it is, so its schema's type reaches the functions. */
export function defineOperation<S extends z.ZodObject<any>>(spec: OperationSpec<S>): OperationSpec<S> {
  return spec
}

/**
 * The error text of an `op` outside the vocabulary of a union of operations:
 * it repeats the `op` given, cut, and names the ones `names` lists.
 */
export function unknownOperationError(names: string): z.core.$ZodErrorMap {
  return (issue) => {
    if (issue.code !== "invalid_union") return undefined
    const op = isRecord(issue.input) ? issue.input.op : undefined
    const named =
      typeof op === "string"
        ? ` ${JSON.stringify(op.length > MAX_SHOWN_OP_LENGTH ? `${op.slice(0, MAX_SHOWN_OP_LENGTH)}…` : op)}`
        : ""
    return `Unknown operation${named}; the operations are: ${names}.`
  }
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
  const needs = (need: OperationNeed) => specs.some((spec) => spec.needs?.includes(need))
  const context: OperationContext = {
    tabs: open.tabs,
    order: open.tabs.map((tab) => tab.sheetId),
    groups: needs("groups") ? await readGroups(open.client, open.id) : [],
    objects: needs("objects") ? await readObjects(open.client, open.id) : noObjects(),
    charts: needs("charts") ? await readCharts(open.client, open.id) : [],
    created: [],
    newIds: [],
    read: new WeakMap(),
  }
  const steps: PlannedOperation[] = []
  for (const [position, op] of args.operations.entries()) {
    const spec = specs[position]!
    const wanted = spec.reads?.(op, context)
    if (wanted !== undefined) {
      context.read.set(op, await readCells(open.client, open.id, wanted, open.tabs, context.objects))
    }
    steps.push({
      name: op.op,
      tabs: spec.tabs(op, context),
      line: spec.describe(op, context),
      lost: spec.loses?.(op, context) ?? [],
      retitled: spec.retitles?.(op, context) ?? [],
      pinned: spec.pins?.(op, context) ?? [],
      shifts: spec.shifts === true,
      requests: spec.requests(op, context),
    })
  }
  const changed = new Set(steps.flatMap((step) => step.tabs.map((tab) => tab.sheetId)))
  return {
    ...open,
    steps,
    requests: steps.flatMap((step) => step.requests),
    lines: steps.map((step) => step.line),
    written: open.tabs.filter((tab) => changed.has(tab.sheetId)),
    onSpreadsheet: specs.some((spec) => spec.onSpreadsheet === true),
  }
}
