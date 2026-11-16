import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import { listNames, type SheetTab } from "./tabs"

const CHARTS_FIELDS = "sheets(properties(sheetId),charts(chartId,spec,position))"

/** The type a pie chart is listed as: Google gives it no basic chart type, only a spec of its own. */
export const PIE_CHART = "PIE"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const text = z.string().optional()

/** The charts are read whole, so that a pin covers all of a chart and an update keeps every part of its spec it does not change. */
const sourceGridReply = z.looseObject({
  sheetId: gridNumber,
  startRowIndex: gridNumber,
  endRowIndex: gridNumber,
  startColumnIndex: gridNumber,
  endColumnIndex: gridNumber,
})

const chartDataReply = z.looseObject({
  sourceRange: z.looseObject({ sources: z.array(sourceGridReply).optional() }).optional(),
})

const basicChartReply = z.looseObject({
  chartType: text,
  legendPosition: text,
  stackedType: text,
  headerCount: gridNumber,
  domains: z.array(z.looseObject({ domain: chartDataReply.optional() })).optional(),
  series: z.array(z.looseObject({ series: chartDataReply.optional(), targetAxis: text, type: text })).optional(),
})

const pieChartReply = z.looseObject({
  legendPosition: text,
  domain: chartDataReply.optional(),
  series: chartDataReply.optional(),
})

const chartSpecReply = z.looseObject({
  title: text,
  basicChart: basicChartReply.optional(),
  pieChart: pieChartReply.optional(),
})

const chartPositionReply = z.looseObject({
  sheetId: gridNumber,
  newSheet: z.boolean().optional(),
  overlayPosition: z
    .looseObject({
      anchorCell: z.looseObject({ sheetId: gridNumber, rowIndex: gridNumber, columnIndex: gridNumber }).optional(),
      offsetXPixels: gridNumber,
      offsetYPixels: gridNumber,
      widthPixels: gridNumber,
      heightPixels: gridNumber,
    })
    .optional(),
})

/** A chart of a tab as Google reports it. */
export const chartReply = z.looseObject({
  chartId: gridNumber,
  spec: chartSpecReply.optional(),
  position: chartPositionReply.optional(),
})

const chartsReply = z.object({
  sheets: z
    .array(
      z.object({ properties: z.object({ sheetId: gridNumber }).optional(), charts: z.array(chartReply).optional() }),
    )
    .optional(),
})

/** The grid range a chart draws from, as Google reports it. */
export type ChartSourceGrid = z.output<typeof sourceGridReply>

export type ChartSpec = z.output<typeof chartSpecReply>

export type ChartPosition = z.output<typeof chartPositionReply>

/** A chart of the spreadsheet, which operations change as they are built in order, so a later operation plans on what an earlier one will have done. */
export type ChartState = {
  chartId: number
  /** The id of the tab the chart is listed on: where it sits, or the tab of its own. */
  sheetId: number
  spec: ChartSpec
  position: ChartPosition
  /** The chart as Google reported it, which a pin covers. */
  definition: unknown
}

/** The charts of every tab as Google reports them now. */
export async function readCharts(client: GoogleClient, id: string): Promise<ChartState[]> {
  const reply = parseReply(
    chartsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: CHARTS_FIELDS },
    }),
    "the charts",
  )
  return (reply.sheets ?? []).flatMap((sheet) =>
    (sheet.charts ?? []).map((chart): ChartState => ({
      chartId: chart.chartId ?? 0,
      sheetId: sheet.properties?.sheetId ?? 0,
      spec: structuredClone(chart.spec ?? {}),
      position: structuredClone(chart.position ?? {}),
      definition: chart,
    })),
  )
}

/** Every range a chart draws its data from, domains first, as Google reports them. */
export function chartSources(spec: ChartSpec | undefined): ChartSourceGrid[] {
  const data = [
    ...(spec?.basicChart?.domains ?? []).map((domain) => domain.domain),
    ...(spec?.basicChart?.series ?? []).map((series) => series.series),
    spec?.pieChart?.domain,
    spec?.pieChart?.series,
  ]
  return data.flatMap((entry) => entry?.sourceRange?.sources ?? [])
}

/** `PIE`, or the basic chart type Google reports; `undefined` for a chart of another kind. */
export function chartKind(spec: ChartSpec): string | undefined {
  return spec.pieChart === undefined ? spec.basicChart?.chartType : PIE_CHART
}

/** How a chart is named in a line or an error: its title in quotes, else its id. */
export function chartName(chart: Pick<ChartState, "chartId" | "spec">): string {
  return chart.spec.title === undefined || chart.spec.title === ""
    ? `#${chart.chartId}`
    : JSON.stringify(chart.spec.title)
}

/** The chart the key names (id, else title, else title ignoring case) among the charts Google reported that are still on a tab. */
export function findChartState(
  tabs: readonly SheetTab[],
  charts: readonly ChartState[],
  key: string | number,
): ChartState {
  const known = charts.filter((chart) => tabs.some((tab) => tab.sheetId === chart.sheetId))
  const wanted = String(key)
  const lowered = wanted.toLowerCase()
  const steps = [
    known.filter((chart) => String(chart.chartId) === wanted),
    known.filter((chart) => chart.spec.title === wanted),
    known.filter((chart) => (chart.spec.title ?? "").toLowerCase() === lowered),
  ]
  const matches = steps.find((step) => step.length > 0) ?? []
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new ToolError(
      "invalid_argument",
      `${matches.length === 0 ? "No chart matches" : "Several charts match"} ${JSON.stringify(wanted)}; the spreadsheet's charts are: ${listNames(known.map((chart) => chartName(chart)))}. Give a chart's id or its exact title.`,
    )
  }
  return match
}
