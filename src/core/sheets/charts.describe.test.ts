import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { PIN_PATTERN } from "../pin"
import { googleSheetsAdd } from "./add"
import { PIVOT_CELL, SALES_PIVOT, SPEND_CHART, WITH_CHARTS } from "./charts.testing"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { spreadsheetHandler } from "./structure.testing"
import { BATCH_UPDATE_URL, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

type Chart = typeof SPEND_CHART

/** `WITH_CHARTS` with the charts of `Plan` changed by `change`. */
const withPlanCharts = (change: (charts: Chart[]) => unknown[]) => ({
  ...WITH_CHARTS,
  sheets: WITH_CHARTS.sheets.map((sheet) =>
    sheet.properties.title === "Plan" ? { ...sheet, charts: change((sheet as any).charts) } : sheet,
  ),
})

const OCCUPIED = [["East", 5], ["West"]]

const handlers = (spreadsheet: unknown, validation: unknown, rows: unknown[][] = []) => [
  spreadsheetHandler(spreadsheet, validation),
  valuesHandler(() => rows),
  post(BATCH_UPDATE_URL),
]

/** The description of one call of `tool`, planned on `spreadsheet`, with `validation` answered to the read of grid data and `rows` to the read of values. */
async function describeOn(
  tool: typeof googleSheetsAdd | typeof googleSheetsRestructure,
  operations: unknown[],
  spreadsheet: unknown = WITH_CHARTS,
  validation: unknown = {},
  rows: unknown[][] = [],
) {
  const h = await writeFixture(handlers(spreadsheet, validation, rows))
  const args = tool.input.parse({ spreadsheet: SPREADSHEET_ID, operations })
  return (await tool.describe!(args as never, h.ctx))!
}

describe("google_sheets_restructure: the pins of the charts an operation changes", () => {
  test.each([
    ["a chart updated", [{ op: "chart_update", chart: 501, title: "New" }]],
    ["a chart moved", [{ op: "chart_move", chart: "Share", at: "Plan!H2" }]],
    ["a chart deleted", [{ op: "chart_delete", chart: 501 }]],
  ])("pin %s as it is, so that it changes with the chart and with no other", async (_name, operations) => {
    const key = operations[0]!.chart as number | string
    const chartOf = (charts: Chart[]) => charts.find((chart) => chart.chartId === (key === "Share" ? 502 : key))!
    const other = (charts: Chart[]) =>
      charts.map((chart) => (chart === chartOf(charts) ? chart : { ...chart, spec: { ...chart.spec, title: "Other" } }))
    const moved = (charts: Chart[]) =>
      charts.map((chart) =>
        chart === chartOf(charts)
          ? { ...chart, position: { overlayPosition: { anchorCell: { rowIndex: 30 }, widthPixels: 10 } } }
          : chart,
      )
    const retitled = (charts: Chart[]) =>
      charts.map((chart) =>
        chart === chartOf(charts) ? { ...chart, spec: { ...chart.spec, fontName: "Arial" } } : chart,
      )

    const base = await describeOn(googleSheetsRestructure, operations)
    const same = await describeOn(googleSheetsRestructure, operations, withPlanCharts(other))
    const position = await describeOn(googleSheetsRestructure, operations, withPlanCharts(moved))
    const spec = await describeOn(googleSheetsRestructure, operations, withPlanCharts(retitled))

    expect(base.pins!.objects).toMatch(PIN_PATTERN)
    expect(same.pins).toEqual(base.pins!)
    expect(position.pins!.objects).not.toBe(base.pins!.objects)
    expect(spec.pins!.objects).not.toBe(base.pins!.objects)
    expect(spec.pins!.values).toBe(base.pins!.values)
  })

  test("counts no overwritten cell for the chart operations, and reads no value", async () => {
    const h = await writeFixture(handlers(WITH_CHARTS, {}))
    const args = googleSheetsRestructure.input.parse({
      spreadsheet: SPREADSHEET_ID,
      operations: [
        { op: "chart_update", chart: 501, title: "x" },
        { op: "chart_delete", chart: 502 },
      ],
    })

    const description = await googleSheetsRestructure.describe!(args, h.ctx)

    expect(description.facts[0]).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 0 } },
    })
    expect(description.text!.body.split("\n")).toEqual([
      'chart_update "Spend": title "x"',
      'chart_delete "Share" (pie chart on Plan)',
    ])
    expect(h.calls().some((call) => call.url.pathname.endsWith("/values:batchGet"))).toBe(false)
  })
})

describe("google_sheets_restructure: pivot_delete in the prompt", () => {
  const operations = [{ op: "pivot_delete", at: "Plan!B2" }]

  test("counts the cells of its output as overwritten, and pins the pivot table and those cells", async () => {
    const base = await describeOn(googleSheetsRestructure, operations, WITH_CHARTS, PIVOT_CELL, OCCUPIED)
    const again = await describeOn(googleSheetsRestructure, operations, WITH_CHARTS, PIVOT_CELL, OCCUPIED)
    const redefined = await describeOn(
      googleSheetsRestructure,
      operations,
      WITH_CHARTS,
      { sheets: [{ data: [{ rowData: [{ values: [{ pivotTable: { ...SALES_PIVOT, rows: [] } }] }] }] }] },
      OCCUPIED,
    )
    const refilled = await describeOn(googleSheetsRestructure, operations, WITH_CHARTS, PIVOT_CELL, [["East", 6]])

    expect(base.facts[0]).toEqual({ label: "Overwrites", value: { text: "{count} cells", values: { count: 3 } } })
    expect(base.pins!.objects).toMatch(PIN_PATTERN)
    expect(again.pins).toEqual(base.pins!)
    expect(redefined.pins!.objects).not.toBe(base.pins!.objects)
    expect(redefined.pins!.values).toBe(base.pins!.values)
    expect(refilled.pins!.values).not.toBe(base.pins!.values)
    expect(refilled.pins!.objects).toBe(base.pins!.objects)
  })

  test("is refused, in the prompt as in the call, when the cell holds no pivot table", async () => {
    const h = await writeFixture(handlers(WITH_CHARTS, {}))
    const args = googleSheetsRestructure.input.parse({ spreadsheet: SPREADSHEET_ID, operations })

    await expect(googleSheetsRestructure.describe!(args, h.ctx)).rejects.toMatchObject({ code: "invalid_argument" })
  })
})

describe("google_sheets_add: chart and pivot in the prompt", () => {
  test("pins no object, counts no overwrite, and says what each operation adds", async () => {
    const description = await describeOn(googleSheetsAdd, [
      { op: "chart", range: "Plan!A1:C13", title: "Spend" },
      { op: "pivot", range: "Plan!A1:D100", pivot_values: [{ column: "D" }], new_tab: true },
    ])

    expect(Object.keys(description.pins ?? {})).toEqual([])
    expect(description.text!.body.split("\n")).toEqual([
      'chart column of Plan!A1:C13 next to the data: title "Spend"',
      'pivot of Plan!A1:D100 on a new tab "Pivot table 1": values SUM of D',
    ])
    expect(description.headline).toEqual({
      text: "About to add to {spreadsheet}",
      values: { spreadsheet: "Budget 2027" },
    })
  })
})

describe("google_sheets_add and google_sheets_restructure: a label that cannot write", () => {
  test.each([
    ["add", { op: "chart", range: "Plan!A1:C13" }],
    ["add", { op: "pivot", range: "Plan!A1:D100", pivot_values: [{ column: "D" }], at: "Plan!F2" }],
    ["restructure", { op: "chart_update", chart: 501, title: "x" }],
    ["restructure", { op: "chart_move", chart: 501, width: 700 }],
    ["restructure", { op: "chart_delete", chart: 501 }],
    ["restructure", { op: "pivot_delete", at: "Plan!B2" }],
  ] as const)("%s fails before any request for %j", async (tool, operation) => {
    const h = await writeFixture(handlers(WITH_CHARTS, PIVOT_CELL), SHEETS_CREDENTIAL)

    const error = await toolError(h[tool]({ spreadsheet: SPREADSHEET_ID, operations: [operation] }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
    expect(writesOf(h.requests)).toEqual([])
  })
})
