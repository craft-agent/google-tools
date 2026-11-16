import { z } from "zod"
import {
  OWN_TAB_WORDS,
  chartLookFields,
  chartPlacementFields,
  lookWords,
  placedOnce,
  sizeWords,
  stackingOnly,
} from "./chart-args"
import {
  DEFAULT_CHART_TYPE,
  DEFAULT_LEGEND,
  LEGENDS,
  anchorOf,
  chartSeries,
  chartSource,
  overlayAt,
} from "./chart-spec"
import { defineOperation, type OperationContext } from "./operations"
import { singleCell, type ClosedArea } from "./operation-blocks"
import { areaLabel, areasOf, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"

const chartSchema = placedOnce(
  stackingOnly(
    z.strictObject({
      op: z.literal("chart"),
      range: rangeText.describe(
        "The chart's data, a block or whole columns (`Sales!A1:C13`, `Sales!A:C`): the first column labels the rows, each other column is a series, and the first row is the header unless `header` is false. A pie chart takes two columns.",
      ),
      ...chartLookFields,
      ...chartPlacementFields,
    }),
    DEFAULT_CHART_TYPE,
  ),
)

type ChartOperation = z.output<typeof chartSchema>

/** What `chart` works out before it changes anything: the data's area, the type, and the cell it sits on when `at` names one. */
function planChart(op: ChartOperation, context: OperationContext) {
  const area = areasOf(op, context.tabs)[0]!
  const type = (op.chart_type ?? DEFAULT_CHART_TYPE).toUpperCase()
  const source = chartSource(area, type)
  const at: ClosedArea | undefined =
    op.at === undefined ? undefined : singleCell(resolveOn(context.tabs, op.at, area.tab), "at")
  return { area, type, source, at }
}

/** `chart`: adds a chart of a block of columns, which never changes a cell; it sits beside the data unless `at` or `new_tab` says otherwise. */
export const chartOperation = defineOperation({
  schema: chartSchema,
  requests(op, context) {
    const { type, source, at } = planChart(op, context)
    const spec = chartSeries(type, source, op.header ?? true)
    const body = (spec.basicChart ?? spec.pieChart)!
    body.legendPosition = LEGENDS[op.legend ?? DEFAULT_LEGEND]
    if (op.stacked === true) body.stackedType = "STACKED"
    if (op.title !== undefined && op.title !== "") spec.title = op.title
    const position = op.new_tab
      ? { newSheet: true }
      : overlayAt(
          at === undefined
            ? { sheetId: source.sheetId, rowIndex: source.startRowIndex ?? 0, columnIndex: source.endColumnIndex }
            : anchorOf(at),
          op.width,
          op.height,
        )
    return [{ addChart: { chart: { spec, position } } }]
  },
  tabs: (op, context) => {
    const { area, at } = planChart(op, context)
    return tabsOfAreas([area, ...(at === undefined ? [] : [at])])
  },
  describe(op, context) {
    const { area, type, at } = planChart(op, context)
    const size = sizeWords(op)
    const place = op.new_tab ? OWN_TAB_WORDS : at === undefined ? "next to the data" : `at ${areaLabel(at)}`
    const words = lookWords(op)
    return `chart ${type.toLowerCase()} of ${areaLabel(area)} ${place}${size === undefined ? "" : `, ${size}`}${words.length === 0 ? "" : `: ${words.join(", ")}`}`
  },
})
