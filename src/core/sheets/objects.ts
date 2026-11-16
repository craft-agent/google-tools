import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { canonicalJson } from "../pin"
import type { GridBounds } from "./a1"
import { findTable } from "./append-table"
import { conditionText } from "./conditions"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { listNames, type SheetTab } from "./tabs"

const OBJECTS_FIELDS =
  "sheets(properties(sheetId,gridProperties(rowCount,columnCount)),tables,conditionalFormats,basicFilter,filterViews)"

/** What a rule says of itself when it colors by a scale rather than by a condition. */
export const COLOR_SCALE = "color scale"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const text = z.string().optional()

/** The objects are read whole, so that what is kept of each is what Google reported and a pin covers all of it. */
const boundsReply = z.looseObject({
  startRowIndex: gridNumber,
  endRowIndex: gridNumber,
  startColumnIndex: gridNumber,
  endColumnIndex: gridNumber,
})

const columnReply = z.looseObject({ columnIndex: gridNumber, columnName: text, columnType: text })

const objectsReply = z.object({
  sheets: z
    .array(
      z.object({
        properties: z
          .object({
            sheetId: gridNumber,
            gridProperties: z.object({ rowCount: gridNumber, columnCount: gridNumber }).optional(),
          })
          .optional(),
        tables: z
          .array(
            z.looseObject({
              tableId: text,
              name: text,
              range: boundsReply.optional(),
              columnProperties: z.array(columnReply).optional(),
            }),
          )
          .optional(),
        conditionalFormats: z
          .array(
            z.looseObject({
              booleanRule: z
                .looseObject({
                  condition: z
                    .looseObject({
                      type: text,
                      values: z.array(z.looseObject({ userEnteredValue: text, relativeDate: text })).optional(),
                    })
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
        basicFilter: z.looseObject({}).optional(),
        filterViews: z
          .array(z.looseObject({ filterViewId: gridNumber, title: text, range: boundsReply.optional() }))
          .optional(),
      }),
    )
    .optional(),
})

/** A column of a native table as Google describes it: its position in the table, name, type and dropdown rule. */
export type ColumnProperty = z.output<typeof columnReply>

/**
 * A native table of a tab. A table an operation of the call adds has no id
 * yet and no `definition`; it only holds its name and its cells until the call
 * lands.
 */
export type TableState = {
  sheetId: number
  tableId?: string
  name: string
  range: GridBounds
  columns: ColumnProperty[]
  /** The table as Google reported it, which a pin covers. */
  definition?: unknown
}

/** A conditional rule of a tab, by its position, with what it says (its condition or `color scale`) and, if Google reported it, its definition. */
export type RuleState = { label: string; definition?: unknown }

/** A filter view of a tab. */
export type ViewState = {
  sheetId: number
  filterViewId: number
  title: string
  range: GridBounds
  definition?: unknown
}

/** How many rows and columns a tab has; a number Google did not report is left out. */
export type TabSize = { rows?: number; columns?: number }

/**
 * The tables, conditional rules, filters and filter views the spreadsheet has,
 * and the grid size of each tab. Operations move them as they are built in
 * order, so a later operation plans on what an earlier one will have done.
 */
export type SheetObjects = {
  tables: TableState[]
  /** The rules of each tab, by tab id, in the order Google applies them. */
  rules: Map<number, RuleState[]>
  /** The tabs that have a basic filter, by tab id, with its definition if Google reported it. */
  filters: Map<number, { definition?: unknown }>
  views: ViewState[]
  /** How many rows and columns each tab has, by tab id. */
  sizes: Map<number, TabSize>
}

/** No objects, for a call whose operations need none. */
export function noObjects(): SheetObjects {
  return { tables: [], rules: new Map(), filters: new Map(), views: [], sizes: new Map() }
}

/** The four bounds of a range, without the other keys Google adds. */
function boundsOf({ startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }: GridBounds = {}): GridBounds {
  return {
    ...(startRowIndex !== undefined && { startRowIndex }),
    ...(endRowIndex !== undefined && { endRowIndex }),
    ...(startColumnIndex !== undefined && { startColumnIndex }),
    ...(endColumnIndex !== undefined && { endColumnIndex }),
  }
}

/** The tables, rules, filters and filter views of every tab, and the size of each tab, as Google reports them now. */
export async function readObjects(client: GoogleClient, id: string): Promise<SheetObjects> {
  const reply = parseReply(
    objectsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: OBJECTS_FIELDS },
    }),
    "the tables, rules and filters",
  )
  const objects = noObjects()
  for (const sheet of reply.sheets ?? []) {
    const sheetId = sheet.properties?.sheetId ?? 0
    const grid = sheet.properties?.gridProperties
    objects.sizes.set(sheetId, { rows: grid?.rowCount, columns: grid?.columnCount })
    for (const table of sheet.tables ?? []) {
      objects.tables.push({
        sheetId,
        tableId: table.tableId ?? "",
        name: table.name ?? "",
        range: boundsOf(table.range),
        columns: table.columnProperties ?? [],
        definition: table,
      })
    }
    const rules = (sheet.conditionalFormats ?? []).map((rule): RuleState => ({
      label: rule.booleanRule === undefined ? COLOR_SCALE : conditionText(rule.booleanRule.condition),
      definition: rule,
    }))
    if (rules.length > 0) objects.rules.set(sheetId, rules)
    if (sheet.basicFilter !== undefined) objects.filters.set(sheetId, { definition: sheet.basicFilter })
    for (const view of sheet.filterViews ?? []) {
      objects.views.push({
        sheetId,
        filterViewId: view.filterViewId ?? 0,
        title: view.title ?? "",
        range: boundsOf(view.range),
        definition: view,
      })
    }
  }
  return objects
}

/** The hash of the definitions, in order, so a change to any of them changes it. */
export function definitionsDigest(definitions: readonly unknown[]): string {
  return createHash("sha256").update(canonicalJson(definitions)).digest("hex")
}

/** The table the key names (id, else name, else name ignoring case) among the tables Google reported that are still on a tab. */
export function findTableState(tabs: readonly SheetTab[], objects: SheetObjects, key: string): TableState {
  const known = objects.tables.filter(
    (table) => table.tableId !== undefined && tabs.some((tab) => tab.sheetId === table.sheetId),
  )
  const match = findTable(
    tabs.map((tab) => ({
      ...tab,
      tables: known
        .filter((table) => table.sheetId === tab.sheetId)
        .map(({ tableId, name, range }) => ({ tableId: tableId ?? "", name, range })),
    })),
    key,
  )
  return known.find((table) => table.tableId === match.table.tableId)!
}

/** The filter view the key names (id, else title, else title ignoring case) among the views Google reported that are still on a tab. */
export function findViewState(tabs: readonly SheetTab[], objects: SheetObjects, key: string): ViewState {
  const known = objects.views.filter((view) => tabs.some((tab) => tab.sheetId === view.sheetId))
  const lowered = key.toLowerCase()
  const steps = [
    known.filter((view) => String(view.filterViewId) === key),
    known.filter((view) => view.title === key),
    known.filter((view) => view.title.toLowerCase() === lowered),
  ]
  const matches = steps.find((step) => step.length > 0) ?? []
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new ToolError(
      "invalid_argument",
      `${matches.length === 0 ? "No filter view matches" : "Several filter views match"} ${JSON.stringify(key)}; the spreadsheet's filter views are: ${listNames(known.map((view) => view.title))}. Give a view's id or its exact title.`,
    )
  }
  return match
}
