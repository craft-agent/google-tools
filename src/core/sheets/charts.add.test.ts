import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { WITH_CHARTS } from "./charts.testing"
import { refusedCall, sendAdd } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** One column of `Plan` as a chart's data, from the first row to `endRowIndex`. */
const column = (index: number, endRowIndex = 13, startRowIndex = 0) => ({
  sourceRange: {
    sources: [{ sheetId: 0, startRowIndex, endRowIndex, startColumnIndex: index, endColumnIndex: index + 1 }],
  },
})

const sendChart = (operation: object, reply?: unknown) =>
  sendAdd([{ op: "chart", ...operation }], { spreadsheet: WITH_CHARTS, reply })

describe("google_sheets_add: chart", () => {
  test("adds a column chart beside the data, with the bottom legend and the first row as its header", async () => {
    const { body, result } = await sendChart({ range: "Plan!A1:C13" })

    expect(body.requests).toEqual([
      {
        addChart: {
          chart: {
            spec: {
              basicChart: {
                chartType: "COLUMN",
                headerCount: 1,
                legendPosition: "BOTTOM_LEGEND",
                domains: [{ domain: column(0) }],
                series: [
                  { series: column(1), targetAxis: "LEFT_AXIS" },
                  { series: column(2), targetAxis: "LEFT_AXIS" },
                ],
              },
            },
            position: {
              overlayPosition: {
                anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 3 },
                widthPixels: 600,
                heightPixels: 371,
              },
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual(["chart column of Plan!A1:C13 next to the data"])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("sets the type, title, legend, stacking and size, and puts the chart at a cell of the data's tab or of another", async () => {
    const own = await sendChart({
      range: "Plan!A1:B13",
      chart_type: "bar",
      title: "  Spend by month ",
      legend: "top",
      stacked: true,
      width: 800,
      at: "H2",
    })

    expect(own.body.requests).toEqual([
      {
        addChart: {
          chart: {
            spec: {
              title: "Spend by month",
              basicChart: {
                chartType: "BAR",
                headerCount: 1,
                legendPosition: "TOP_LEGEND",
                stackedType: "STACKED",
                domains: [{ domain: column(0) }],
                series: [{ series: column(1), targetAxis: "BOTTOM_AXIS" }],
              },
            },
            position: {
              overlayPosition: {
                anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: 7 },
                widthPixels: 800,
                heightPixels: 371,
              },
            },
          },
        },
      },
    ])
    expect(own.result.applied).toEqual([
      'chart bar of Plan!A1:B13 at Plan!H2, 800x…px: title "Spend by month", legend top, stacked',
    ])

    const other = await sendChart({ range: "Plan!A1:B13", at: "'My Tab'!B3" })
    expect(other.body.requests[0]).toMatchObject({
      addChart: {
        chart: { position: { overlayPosition: { anchorCell: { sheetId: 77, rowIndex: 2, columnIndex: 1 } } } },
      },
    })
    expect(other.result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("types a combo chart's first series as columns and the rest as lines", async () => {
    const { body } = await sendChart({ range: "Plan!A1:D13", chart_type: "combo", legend: "none" })

    const { basicChart } = (body.requests[0] as any).addChart.chart.spec
    expect(basicChart.chartType).toBe("COMBO")
    expect(basicChart.legendPosition).toBe("NO_LEGEND")
    expect(basicChart.series.map((series: { type: string }) => series.type)).toEqual(["COLUMN", "LINE", "LINE"])
  })

  test("keeps the header row of a pie chart out of its data, and gives it no header count", async () => {
    const { body } = await sendChart({ range: "Plan!A1:B13", chart_type: "pie", title: "Share" })

    expect((body.requests[0] as any).addChart.chart.spec).toEqual({
      title: "Share",
      pieChart: { legendPosition: "BOTTOM_LEGEND", domain: column(0, 13, 1), series: column(1, 13, 1) },
    })
    const bare = await sendChart({ range: "Plan!A1:B13", chart_type: "pie", header: false })
    expect((bare.body.requests[0] as any).addChart.chart.spec.pieChart.domain).toEqual(column(0))
  })

  test("takes whole columns, with no header row, and anchors beside them on the first row", async () => {
    const { body } = await sendChart({ range: "Plan!A:C", header: false })

    const { spec, position } = (body.requests[0] as any).addChart.chart
    expect(spec.basicChart.headerCount).toBe(0)
    expect(spec.basicChart.domains[0].domain.sourceRange.sources[0]).toEqual({
      sheetId: 0,
      startColumnIndex: 0,
      endColumnIndex: 1,
    })
    expect(position.overlayPosition.anchorCell).toEqual({ sheetId: 0, rowIndex: 0, columnIndex: 3 })
  })

  test("puts a chart on a tab of its own, and lists each new chart's id and title as Google answered", async () => {
    const reply = {
      replies: [
        { addChart: { chart: { chartId: 910, spec: { title: "Sales" } } } },
        { addChart: { chart: { chartId: 911 } } },
      ],
    }
    const { body, result } = await sendAdd(
      [
        { op: "chart", range: "Plan!A1:B13", new_tab: true, title: "Sales" },
        { op: "chart", range: "Plan!A1:B13" },
      ],
      { spreadsheet: WITH_CHARTS, reply },
    )

    expect((body.requests[0] as any).addChart.chart.position).toEqual({ newSheet: true })
    expect(result.applied[0]).toBe('chart column of Plan!A1:B13 on a new tab of its own: title "Sales"')
    expect(result.charts).toEqual([
      { chart_id: 910, title: "Sales" },
      { chart_id: 911, title: null },
    ])
  })

  test.each([
    ["one column", { range: "Plan!A1:A13" }, "label column and at least one value column"],
    ["a pie chart of three columns", { range: "Plan!A1:C13", chart_type: "pie" }, "two columns"],
    ["whole rows", { range: "Plan!3:5" }, "block or whole columns"],
    ["a stacked line chart", { range: "Plan!A1:C13", chart_type: "line", stacked: true }, "`stacked` goes with"],
    ["a stacked pie chart", { range: "Plan!A1:B13", chart_type: "pie", stacked: true }, "`stacked` goes with"],
    ["at and new_tab", { range: "Plan!A1:C13", at: "H2", new_tab: true }, "not both"],
    [
      "a size on a tab of its own",
      { range: "Plan!A1:C13", new_tab: true, height: 300 },
      "takes no `width` or `height`",
    ],
    ["an anchor that is not one cell", { range: "Plan!A1:C13", at: "H2:I3" }, "`at` is one cell"],
    ["a tab the spreadsheet lacks", { range: "Nope!A1:C13" }, "names no tab"],
    ["a chart type outside the list", { range: "Plan!A1:C13", chart_type: "donut" }, "chart_type"],
    ["a size under the smallest", { range: "Plan!A1:C13", width: 10 }, "width"],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refusedCall("add", [{ op: "chart", ...operation }], { spreadsheet: WITH_CHARTS })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})
