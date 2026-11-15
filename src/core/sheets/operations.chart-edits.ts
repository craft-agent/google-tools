import { z } from "zod"
import { ToolError } from "../errors"
import { quoteTab } from "./a1"
import {
  OWN_TAB_WORDS,
  chartKey,
  chartLookFields,
  chartPlacementFields,
  lookWords,
  placedOnce,
  sizeWords,
  stackingOnly,
} from "./chart-args"
import { LEGENDS, anchorOf, overlayAt, updatedSpec } from "./chart-spec"
import { chartKind, chartName, chartSources, findChartState } from "./charts"
import { defineOperation, type OperationContext } from "./operations"
import { singleCell } from "./operation-blocks"
import { areaLabel, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"
import { tabWithId } from "./operations.tabs"

/** The fields of an overlay position that moving a chart to a cell sets, which the move gives their start again. */
const MOVED_FIELDS = "anchorCell,offsetXPixels,offsetYPixels,widthPixels,heightPixels"

const chartUpdateSchema = stackingOnly(
  z
    .strictObject({
      op: z.literal("chart_update"),
      chart: chartKey,
      range: rangeText
        .optional()
        .describe(
          "The chart's new data, a block or whole columns, which rebuilds its series; no tab means the tab the chart's data is on.",
        ),
      ...chartLookFields,
    })
    .refine(
      (op) => [op.range, op.chart_type, op.title, op.legend, op.stacked, op.header].some((part) => part !== undefined),
      {
        message: "Give `range`, `chart_type`, `title`, `legend`, `stacked` or `header` to change.",
      },
    ),
)

const chartMoveSchema = placedOnce(
  z
    .strictObject({ op: z.literal("chart_move"), chart: chartKey, ...chartPlacementFields })
    .refine((op) => [op.at, op.new_tab, op.width, op.height].some((part) => part !== undefined), {
      message: "Give `at`, `new_tab`, `width` or `height`.",
    }),
)

const chartDeleteSchema = z.strictObject({ op: z.literal("chart_delete"), chart: chartKey })

/** What `chart_update` works out before it changes anything: the chart, its own tab, the range it is rebuilt from, and the spec it will have. */
function resolveUpdate(op: z.output<typeof chartUpdateSchema>, context: OperationContext) {
  const current = findChartState(context.tabs, context.charts, op.chart)
  const own = tabWithId(context.tabs, current.sheetId)
  const dataSheetId = chartSources(current.spec)[0]?.sheetId ?? 0
  const dataTab = context.tabs.find((tab) => tab.sheetId === dataSheetId) ?? own
  const area = op.range === undefined ? undefined : resolveOn(context.tabs, op.range, dataTab)
  const spec = updatedSpec(current, {
    ...(op.chart_type !== undefined && { chartType: op.chart_type.toUpperCase() }),
    ...(op.title !== undefined && { title: op.title }),
    ...(op.legend !== undefined && { legend: LEGENDS[op.legend] }),
    ...(op.stacked !== undefined && { stacked: op.stacked }),
    ...(op.header !== undefined && { header: op.header }),
    ...(area !== undefined && { area }),
  })
  return { current, own, area, spec }
}

/** `chart_update`: changes a chart's data, type, title, legend, stacking or header, keeping every other part of what it has. */
export const chartUpdateOperation = defineOperation({
  schema: chartUpdateSchema,
  needs: ["charts"],
  requests(op, context) {
    const { current, spec } = resolveUpdate(op, context)
    current.spec = spec
    return [{ updateChartSpec: { chartId: current.chartId, spec } }]
  },
  tabs(op, context) {
    const { own, area } = resolveUpdate(op, context)
    return tabsOfAreas([{ tab: own, grid: { sheetId: own.sheetId } }, ...(area === undefined ? [] : [area])])
  },
  describe(op, context) {
    const { current, area } = resolveUpdate(op, context)
    const words = [
      ...(area === undefined ? [] : [`data ${areaLabel(area)}`]),
      ...(op.chart_type === undefined ? [] : [`type ${op.chart_type}`]),
      ...lookWords(op),
      ...(op.header === undefined ? [] : [op.header ? "first row is the header" : "no header row"]),
    ]
    return `chart_update ${chartName(current)}: ${words.join(", ")}`
  },
  pins: (op, context) => [findChartState(context.tabs, context.charts, op.chart).definition],
})

/** What `chart_move` works out before it changes anything: the chart, its own tab, the cell it moves to, and the tab that cell lies on when the chart has none. */
function resolveMove(op: z.output<typeof chartMoveSchema>, context: OperationContext) {
  const current = findChartState(context.tabs, context.charts, op.chart)
  const own = tabWithId(context.tabs, current.sheetId)
  const overlay = current.position.overlayPosition
  const at =
    op.at === undefined
      ? undefined
      : singleCell(resolveOn(context.tabs, op.at, overlay === undefined ? context.tabs[0]! : own), "at")
  if (at === undefined && op.new_tab === undefined && overlay === undefined) {
    throw new ToolError(
      "invalid_argument",
      `Chart ${chartName(current)} is on a tab of its own; give \`at\` to place it on a tab.`,
    )
  }
  return { current, own, overlay, at }
}

/** `chart_move`: moves a chart to a cell or to a tab of its own, or resizes it where it is; a size left out stays as it is. */
export const chartMoveOperation = defineOperation({
  schema: chartMoveSchema,
  needs: ["charts"],
  requests(op, context) {
    const { current, overlay, at } = resolveMove(op, context)
    const sized = { widthPixels: op.width, heightPixels: op.height }
    if (op.new_tab !== undefined) {
      current.position = { newSheet: true }
      return [{ updateEmbeddedObjectPosition: { objectId: current.chartId, newPosition: { newSheet: true } } }]
    }
    if (at === undefined) {
      const given = Object.entries(sized).filter(([, pixels]) => pixels !== undefined)
      Object.assign(overlay!, Object.fromEntries(given))
      return [
        {
          updateEmbeddedObjectPosition: {
            objectId: current.chartId,
            fields: given.map(([field]) => field).join(","),
            newPosition: { overlayPosition: Object.fromEntries(given) },
          },
        },
      ]
    }
    const moved = overlayAt(anchorOf(at), op.width ?? overlay?.widthPixels, op.height ?? overlay?.heightPixels)
    Object.assign(moved.overlayPosition!, { offsetXPixels: 0, offsetYPixels: 0 })
    current.position = structuredClone(moved)
    return [
      {
        updateEmbeddedObjectPosition: { objectId: current.chartId, fields: MOVED_FIELDS, newPosition: moved },
      },
    ]
  },
  tabs(op, context) {
    const { own, at } = resolveMove(op, context)
    return tabsOfAreas([{ tab: own, grid: { sheetId: own.sheetId } }, ...(at === undefined ? [] : [at])])
  },
  describe(op, context) {
    const { current, at } = resolveMove(op, context)
    const size = sizeWords(op)
    if (op.new_tab !== undefined) return `chart_move ${chartName(current)} ${OWN_TAB_WORDS}`
    if (at === undefined) return `chart_move ${chartName(current)}: size ${size}`
    return `chart_move ${chartName(current)} to ${areaLabel(at)}${size === undefined ? "" : `, ${size}`}`
  },
  pins: (op, context) => [findChartState(context.tabs, context.charts, op.chart).definition],
})

/** `chart_delete`: removes a chart, which never changes a cell. */
export const chartDeleteOperation = defineOperation({
  schema: chartDeleteSchema,
  needs: ["charts"],
  requests(op, context) {
    const current = findChartState(context.tabs, context.charts, op.chart)
    context.charts = context.charts.filter((chart) => chart !== current)
    return [{ deleteEmbeddedObject: { objectId: current.chartId } }]
  },
  tabs: (op, context) => [tabWithId(context.tabs, findChartState(context.tabs, context.charts, op.chart).sheetId)],
  describe(op, context) {
    const current = findChartState(context.tabs, context.charts, op.chart)
    const kind = chartKind(current.spec)
    const tab = tabWithId(context.tabs, current.sheetId)
    return `chart_delete ${chartName(current)} (${kind === undefined ? "chart" : `${kind.toLowerCase()} chart`} on ${quoteTab(tab.title)})`
  },
  pins: (op, context) => [findChartState(context.tabs, context.charts, op.chart).definition],
})
