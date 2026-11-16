import { ToolError } from "../errors"
import { PIE_CHART, chartName, type ChartPosition, type ChartSpec, type ChartState } from "./charts"
import type { GridRange, ResolvedRange } from "./grid"
import type { ClosedArea } from "./operation-blocks"

/** The types of chart `chart` and `chart_update` take, which Google names in capitals. */
export const CHART_TYPES = ["bar", "column", "line", "area", "scatter", "combo", "pie"] as const

export type ChartType = (typeof CHART_TYPES)[number]

/** The type of a chart that is given none. */
export const DEFAULT_CHART_TYPE: ChartType = "column"

/** The types whose series may stack. */
const STACKABLE_TYPES: readonly string[] = ["BAR", "COLUMN", "AREA", "COMBO"]

/** Where the legend goes, by the word that says it, and Google's name for it. */
export const LEGENDS = {
  bottom: "BOTTOM_LEGEND",
  top: "TOP_LEGEND",
  left: "LEFT_LEGEND",
  right: "RIGHT_LEGEND",
  none: "NO_LEGEND",
} as const

export const LEGEND_NAMES = [
  "bottom",
  "top",
  "left",
  "right",
  "none",
] as const satisfies readonly (keyof typeof LEGENDS)[]

/** The legend a new chart gets. */
export const DEFAULT_LEGEND: keyof typeof LEGENDS = "bottom"

/** The size of a chart in pixels that Sheets itself gives a new one. */
const DEFAULT_CHART_SIZE = { width: 600, height: 371 }

/** The keys of a chart's body that a rebuilt chart keeps from the one it replaces. */
const KEPT_KEYS = ["legendPosition", "stackedType", "axis"] as const

/** The axis a bar chart's series are measured on, and the axis of the other types. */
const BAR_AXIS = "BOTTOM_AXIS"
const COLUMN_AXIS = "LEFT_AXIS"

/** A block of columns a chart is drawn from: whole columns or a block, never whole rows. */
export type ChartSource = GridRange & { startColumnIndex: number; endColumnIndex: number }

/** What `chart_update` changes of a chart; a part left out stays as the chart has it. */
export type ChartChanges = {
  /** Google's name for the new type. */
  chartType?: string
  title?: string
  /** Google's name for the legend's position. */
  legend?: string
  stacked?: boolean
  header?: boolean
  /** The range the chart is rebuilt from. */
  area?: ResolvedRange
}

/** Whether a chart of the type, as Google names it, may stack its series. */
export function isStackable(type: string): boolean {
  return STACKABLE_TYPES.includes(type)
}

/** The block of columns a chart of `type` is drawn from, refused unless it has a label column and the value columns the type takes. */
export function chartSource({ grid }: ResolvedRange, type: string): ChartSource {
  const { startColumnIndex, endColumnIndex } = grid
  if (startColumnIndex === undefined || endColumnIndex === undefined) {
    throw new ToolError(
      "invalid_argument",
      "A chart's range is a block or whole columns, such as `Sales!A1:C13` or `Sales!A:C`.",
    )
  }
  if (endColumnIndex - startColumnIndex < 2) {
    throw new ToolError("invalid_argument", "A chart's range needs a label column and at least one value column.")
  }
  if (type === PIE_CHART && endColumnIndex - startColumnIndex !== 2) {
    throw new ToolError("invalid_argument", "A pie chart takes two columns: labels, then values.")
  }
  return { ...grid, startColumnIndex, endColumnIndex }
}

/** The data of one column of the source, without its header cell when `skipHeader`. */
function columnData(source: ChartSource, index: number, skipHeader = false) {
  return {
    sourceRange: {
      sources: [
        {
          ...source,
          startColumnIndex: index,
          endColumnIndex: index + 1,
          ...(skipHeader && { startRowIndex: (source.startRowIndex ?? 0) + 1 }),
        },
      ],
    },
  }
}

/** The `basicChart` or `pieChart` of a spec over the source: its first column labels, and each other column is a series. */
export function chartSeries(type: string, source: ChartSource, header: boolean): ChartSpec {
  const first = source.startColumnIndex
  if (type === PIE_CHART) {
    // A pie has no header count: its header row stays out of the data.
    return { pieChart: { domain: columnData(source, first, header), series: columnData(source, first + 1, header) } }
  }
  const axis = type === "BAR" ? BAR_AXIS : COLUMN_AXIS
  const series = Array.from({ length: source.endColumnIndex - first - 1 }, (_, position) => ({
    series: columnData(source, first + 1 + position),
    targetAxis: axis,
    ...(type === "COMBO" && { type: position === 0 ? "COLUMN" : "LINE" }),
  }))
  return {
    basicChart: {
      chartType: type,
      headerCount: header ? 1 : 0,
      domains: [{ domain: columnData(source, first) }],
      series,
    },
  }
}

/** The cell of a tab that a chart is anchored at, as Google names it. */
export function anchorOf({ grid }: ClosedArea): { sheetId: number; rowIndex: number; columnIndex: number } {
  return { sheetId: grid.sheetId, rowIndex: grid.startRowIndex, columnIndex: grid.startColumnIndex }
}

/** The position of a chart over a cell of a tab, at the size given and else the size Sheets gives. */
export function overlayAt(
  anchorCell: ReturnType<typeof anchorOf>,
  width: number | undefined,
  height: number | undefined,
): ChartPosition {
  return {
    overlayPosition: {
      anchorCell,
      widthPixels: width ?? DEFAULT_CHART_SIZE.width,
      heightPixels: height ?? DEFAULT_CHART_SIZE.height,
    },
  }
}

/** The type the chart has now and the type it will have, refusing a change of kind: Google keeps a pie chart a pie chart. */
function chartTypes(chart: ChartState, changes: ChartChanges): { kind: string; target: string } {
  const kind = chart.spec.pieChart === undefined ? chart.spec.basicChart?.chartType : PIE_CHART
  if (kind === undefined) {
    throw new ToolError(
      "invalid_argument",
      `Chart ${chartName(chart)} is not a basic or pie chart; delete it and add it again.`,
    )
  }
  const target = changes.chartType ?? kind
  if ((target === PIE_CHART) !== (kind === PIE_CHART)) {
    throw new ToolError(
      "invalid_argument",
      "A chart cannot turn into or out of a pie chart; delete it and add it again.",
    )
  }
  return { kind, target }
}

/** Gives the series of a basic chart the axis and, for a combo, the kind of line that the new type draws them with. */
function retypeSeries(body: NonNullable<ChartSpec["basicChart"]>, target: string): void {
  const axis = target === "BAR" ? BAR_AXIS : COLUMN_AXIS
  body.chartType = target
  for (const [position, series] of (body.series ?? []).entries()) {
    if (target === "BAR" || series.targetAxis === BAR_AXIS) series.targetAxis = axis
    if (target === "COMBO") series.type = position === 0 ? "COLUMN" : "LINE"
    else delete series.type
  }
}

/**
 * The spec the chart will have: its current spec with the changes. A new
 * range rebuilds the series from it (keeping the legend, stacking and axes),
 * else only the type and the header change. The chart's own state is not
 * touched.
 */
export function updatedSpec(chart: ChartState, changes: ChartChanges): ChartSpec {
  const { kind, target } = chartTypes(chart, changes)
  if (kind === PIE_CHART && changes.header !== undefined && changes.area === undefined) {
    throw new ToolError("invalid_argument", "A pie chart's header setting goes with `range`, which it is rebuilt from.")
  }
  if (changes.stacked === true && !isStackable(target)) {
    throw new ToolError("invalid_argument", `A ${target.toLowerCase()} chart cannot be stacked.`)
  }
  const spec = structuredClone(chart.spec)
  let body = (spec.basicChart ?? spec.pieChart)!
  if (changes.area !== undefined) {
    const header = changes.header ?? (kind === PIE_CHART ? true : (spec.basicChart?.headerCount ?? 0) > 0)
    const rebuilt = chartSeries(target, chartSource(changes.area, target), header)
    const fresh = (rebuilt.basicChart ?? rebuilt.pieChart)!
    for (const key of KEPT_KEYS) if (key in body) (fresh as Record<string, unknown>)[key] = body[key]
    delete spec.basicChart
    delete spec.pieChart
    Object.assign(spec, rebuilt)
    body = fresh
  } else if (spec.basicChart !== undefined) {
    if (changes.header !== undefined) spec.basicChart.headerCount = changes.header ? 1 : 0
    if (target !== kind) retypeSeries(spec.basicChart, target)
  }
  if (changes.legend !== undefined) body.legendPosition = changes.legend
  if (changes.stacked !== undefined) body.stackedType = changes.stacked ? "STACKED" : "NOT_STACKED"
  else if (!isStackable(target)) delete body.stackedType
  if (changes.title === "") delete spec.title
  else if (changes.title !== undefined) spec.title = changes.title
  return spec
}
