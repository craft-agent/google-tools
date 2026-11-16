import { z } from "zod"
import { ToolError } from "../errors"
import { quoteTab } from "./a1"
import { filterColumnsArg, filterSpecs, filterWords, type FilterColumns } from "./filter-columns"
import { defineOperation, type OperationContext } from "./operations"
import { areaLabel, areasOf, rangeText, tabsOfAreas } from "./operation-ranges"
import { tabNamed, tabTitle } from "./operations.tabs"

const filterFields = {
  range: rangeText.describe("The filter's range, with its header row (`Plan!A1:F200`, `Plan!A:F`)."),
  filter_columns: filterColumnsArg
    .optional()
    .describe(
      "The criteria, each `{ column, hide?, when?, values? }`: values to hide in a column, or a condition its values must meet to show.",
    ),
}

const filterSchema = z.strictObject({ op: z.literal("filter"), ...filterFields })
const filterReplaceSchema = z.strictObject({ op: z.literal("filter_replace"), ...filterFields })
const filterClearSchema = z.strictObject({
  op: z.literal("filter_clear"),
  tab: tabTitle.optional().describe("The tab's title; left out, the first tab."),
})

/** The area of the filter, and the criteria as a suffix of its line. */
function filterOf(op: { range: string; filter_columns?: FilterColumns }, context: OperationContext) {
  const area = areasOf(op, context.tabs)[0]!
  const words = filterWords(op.filter_columns)
  return { area, criteria: words === "" ? "" : `: ${words}` }
}

/** Google's request that sets the tab's basic filter, which the tab has from then on. */
function setFilter(op: { range: string; filter_columns?: FilterColumns }, context: OperationContext) {
  const { area } = filterOf(op, context)
  context.objects.filters.set(area.tab.sheetId, {})
  return [
    {
      setBasicFilter: {
        filter: { range: area.grid, filterSpecs: filterSpecs(op.filter_columns, area.grid) },
      },
    },
  ]
}

/** Refuses a tab that has a basic filter already, naming the operation that replaces it. */
function requireNoFilter(op: { range: string }, context: OperationContext): void {
  const { tab } = areasOf(op, context.tabs)[0]!
  if (context.objects.filters.has(tab.sheetId)) {
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(tab.title)} already has a filter, and filter sets one only where there is none; to replace it use google_sheets_restructure's filter_replace.`,
    )
  }
}

/** `filter`: sets a tab's basic filter, on a tab that has none. */
export const filterOperation = defineOperation({
  schema: filterSchema,
  needs: ["objects"],
  requests(op, context) {
    requireNoFilter(op, context)
    return setFilter(op, context)
  },
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, context) {
    requireNoFilter(op, context)
    const { area, criteria } = filterOf(op, context)
    return `filter ${areaLabel(area)}${criteria}`
  },
})

/** The definition of the filter the tab has now, which an approval pins; none for a tab without one. */
function pinnedFilter(context: OperationContext, sheetId: number): unknown[] {
  const { definition } = context.objects.filters.get(sheetId) ?? {}
  return definition === undefined ? [] : [definition]
}

/** `filter_replace`: sets a tab's basic filter, replacing the one it has. */
export const filterReplaceOperation = defineOperation({
  schema: filterReplaceSchema,
  needs: ["objects"],
  requests: setFilter,
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, context) {
    const { area, criteria } = filterOf(op, context)
    const replaces = context.objects.filters.has(area.tab.sheetId) ? " (replaces the tab's filter)" : ""
    return `filter_replace ${areaLabel(area)}${replaces}${criteria}`
  },
  pins: (op, context) => pinnedFilter(context, filterOf(op, context).area.tab.sheetId),
})

/** The tab whose filter goes, refused when it has none. */
function tabWithFilter(op: { tab?: string }, context: OperationContext) {
  const tab = tabNamed(context.tabs, op.tab)
  if (!context.objects.filters.has(tab.sheetId)) {
    throw new ToolError("invalid_argument", `${JSON.stringify(tab.title)} has no filter to clear.`)
  }
  return tab
}

/** `filter_clear`: removes a tab's basic filter, which the tab must have. */
export const filterClearOperation = defineOperation({
  schema: filterClearSchema,
  needs: ["objects"],
  requests(op, context) {
    const tab = tabWithFilter(op, context)
    context.objects.filters.delete(tab.sheetId)
    return [{ clearBasicFilter: { sheetId: tab.sheetId } }]
  },
  tabs: (op, context) => [tabWithFilter(op, context)],
  describe: (op, context) => `filter_clear ${quoteTab(tabWithFilter(op, context).title)}`,
  pins: (op, context) => pinnedFilter(context, tabWithFilter(op, context).sheetId),
})
