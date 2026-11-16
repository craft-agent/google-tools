import { z } from "zod"
import { gridRangeA1 } from "./a1"
import { filterColumnsArg, filterSpecs, filterWords } from "./filter-columns"
import type { GridRange } from "./grid"
import { findViewState } from "./objects"
import { defineOperation, type OperationContext } from "./operations"
import { areaLabel, areasOf, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"
import { tabWithId } from "./operations.tabs"

const MAX_VIEW_LENGTH = 200

const viewName = z.string().trim().min(1).max(MAX_VIEW_LENGTH)

const viewKey = z
  .union([z.string().min(1).max(MAX_VIEW_LENGTH), z.number().int()])
  .describe("The filter view's id, or its title.")

const criteria = filterColumnsArg
  .optional()
  .describe(
    "The criteria, each `{ column, hide?, when?, values? }`: values to hide in a column, or a condition its values must meet to show.",
  )

const filterViewSchema = z.strictObject({
  op: z.literal("filter_view"),
  range: rangeText.describe("The view's range, with its header row (`Plan!A1:F200`, `Plan!A:F`)."),
  name: viewName.describe("The view's title."),
  filter_columns: criteria,
})

const filterViewUpdateSchema = z
  .strictObject({
    op: z.literal("filter_view_update"),
    view: viewKey,
    range: rangeText.optional().describe("The view's new range; no tab means the view's own tab."),
    name: viewName.optional().describe("The view's new title."),
    filter_columns: criteria.describe(
      "The view's new criteria, which replace its criteria whole; an empty list removes them all.",
    ),
  })
  .refine((op) => op.range !== undefined || op.name !== undefined || op.filter_columns !== undefined, {
    message: "Give `range`, `name` or `filter_columns` to change.",
  })

const filterViewDeleteSchema = z.strictObject({ op: z.literal("filter_view_delete"), view: viewKey })

/** `filter_view`: adds a filter view of a range, which the result lists by its id. */
export const filterViewOperation = defineOperation({
  schema: filterViewSchema,
  requests(op, { tabs }) {
    const { grid } = areasOf(op, tabs)[0]!
    return [
      { addFilterView: { filter: { title: op.name, range: grid, filterSpecs: filterSpecs(op.filter_columns, grid) } } },
    ]
  },
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, { tabs }) {
    const words = filterWords(op.filter_columns)
    return `filter_view ${JSON.stringify(op.name)} on ${areaLabel(areasOf(op, tabs)[0]!)}${words === "" ? "" : `: ${words}`}`
  },
})

/** What `filter_view_update` works out before it changes anything: the view, its tab, its new range if any, and the range it will have. */
function resolveUpdate(op: z.output<typeof filterViewUpdateSchema>, context: OperationContext) {
  const current = findViewState(context.tabs, context.objects, String(op.view))
  const own = tabWithId(context.tabs, current.sheetId)
  const area = op.range === undefined ? undefined : resolveOn(context.tabs, op.range, own)
  const range: GridRange = area?.grid ?? { sheetId: current.sheetId, ...current.range }
  return { current, own, area, range }
}

/** `filter_view_update`: changes a filter view's range, title or criteria, touching nothing it does not name. */
export const filterViewUpdateOperation = defineOperation({
  schema: filterViewUpdateSchema,
  needs: ["objects"],
  requests(op, context) {
    const { current, area, range } = resolveUpdate(op, context)
    const specs = op.filter_columns === undefined ? undefined : filterSpecs(op.filter_columns, range)
    const fields = [
      ...(area === undefined ? [] : ["range"]),
      ...(op.name === undefined ? [] : ["title"]),
      ...(specs === undefined ? [] : ["filterSpecs"]),
    ]
    const { sheetId, ...bounds } = range
    Object.assign(current, { sheetId, range: bounds, ...(op.name !== undefined && { title: op.name }) })
    return [
      {
        updateFilterView: {
          filter: {
            filterViewId: current.filterViewId,
            ...(area !== undefined && { range: area.grid }),
            ...(op.name !== undefined && { title: op.name }),
            ...(specs !== undefined && { filterSpecs: specs }),
          },
          fields: fields.join(","),
        },
      },
    ]
  },
  tabs(op, context) {
    const { own, area } = resolveUpdate(op, context)
    return tabsOfAreas([{ tab: own, grid: { sheetId: own.sheetId } }, ...(area === undefined ? [] : [area])])
  },
  describe(op, context) {
    const { current, area } = resolveUpdate(op, context)
    const words = [
      ...(op.name === undefined ? [] : [`rename to ${JSON.stringify(op.name)}`]),
      ...(area === undefined ? [] : [`range ${areaLabel(area)}`]),
      ...(op.filter_columns === undefined
        ? []
        : [
            op.filter_columns.length === 0
              ? "remove all criteria"
              : `replace criteria with ${filterWords(op.filter_columns)}`,
          ]),
    ]
    return `filter_view_update ${JSON.stringify(current.title)}: ${words.join(", ")}`
  },
  pins(op, context) {
    const { definition } = resolveUpdate(op, context).current
    return definition === undefined ? [] : [definition]
  },
})

/** `filter_view_delete`: removes a filter view. */
export const filterViewDeleteOperation = defineOperation({
  schema: filterViewDeleteSchema,
  needs: ["objects"],
  requests(op, context) {
    const current = findViewState(context.tabs, context.objects, String(op.view))
    context.objects.views = context.objects.views.filter((view) => view !== current)
    return [{ deleteFilterView: { filterId: current.filterViewId } }]
  },
  tabs: (op, context) => [
    tabWithId(context.tabs, findViewState(context.tabs, context.objects, String(op.view)).sheetId),
  ],
  describe(op, context) {
    const current = findViewState(context.tabs, context.objects, String(op.view))
    const tab = tabWithId(context.tabs, current.sheetId)
    return `filter_view_delete ${JSON.stringify(current.title)} (${gridRangeA1(tab.title, current.range)})`
  },
  pins(op, context) {
    const { definition } = findViewState(context.tabs, context.objects, String(op.view))
    return definition === undefined ? [] : [definition]
  },
})
