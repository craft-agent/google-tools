import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { SPEND_CHART, WITH_CHARTS } from "./charts.testing"
import { refusedCall, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const send = (operations: object[]) => sendRestructure(operations, { spreadsheet: WITH_CHARTS })

const refused = (operations: object[]) => refusedCall("restructure", operations, { spreadsheet: WITH_CHARTS })

/** The spec of the chart `Spend` with `basicChart` changed by `change`, and the rest as Google reports it. */
const spendWith = (change: Record<string, unknown>, top: Record<string, unknown> = {}) => ({
  ...SPEND_CHART.spec,
  ...top,
  basicChart: { ...SPEND_CHART.spec.basicChart, ...change },
})

/** One column of `Plan` as a chart's data. */
const column = (index: number, endRowIndex = 13) => ({
  sourceRange: {
    sources: [{ sheetId: 0, startRowIndex: 0, endRowIndex, startColumnIndex: index, endColumnIndex: index + 1 }],
  },
})

describe("google_sheets_restructure: chart_update", () => {
  test("rebuilds the spec from the chart's own, keeping what it does not change, and sets the title, legend and stacking", async () => {
    const { body, result } = await send([
      { op: "chart_update", chart: 501, title: " New ", legend: "top", stacked: true },
    ])

    expect(body.requests).toEqual([
      {
        updateChartSpec: {
          chartId: 501,
          spec: spendWith({ legendPosition: "TOP_LEGEND", stackedType: "STACKED" }, { title: "New" }),
        },
      },
    ])
    expect(result.applied).toEqual(['chart_update "Spend": title "New", legend top, stacked'])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("finds the chart by id given as text, by its title, or by its title ignoring case, and removes a title with an empty one", async () => {
    const { body } = await send([
      { op: "chart_update", chart: "501", stacked: false },
      { op: "chart_update", chart: "share", title: "", legend: "none" },
    ])

    expect((body.requests[0] as any).updateChartSpec.spec.basicChart.stackedType).toBe("NOT_STACKED")
    expect(body.requests[1]).toEqual({
      updateChartSpec: {
        chartId: 502,
        spec: { pieChart: { legendPosition: "NO_LEGEND", domain: expect.anything(), series: expect.anything() } },
      },
    })
  })

  test("changes the type and moves each series to the axis and kind of line the new type draws", async () => {
    const { body } = await send([
      { op: "chart_update", chart: 501, chart_type: "bar" },
      { op: "chart_update", chart: 501, chart_type: "combo" },
      { op: "chart_update", chart: 501, chart_type: "line" },
    ])

    const types = body.requests.map((request: any) => {
      const { chartType, series } = request.updateChartSpec.spec.basicChart
      return { chartType, series: series.map(({ targetAxis, type }: any) => ({ targetAxis, type })) }
    })
    expect(types).toEqual([
      { chartType: "BAR", series: [{ targetAxis: "BOTTOM_AXIS" }, { targetAxis: "BOTTOM_AXIS" }] },
      {
        chartType: "COMBO",
        series: [
          { targetAxis: "LEFT_AXIS", type: "COLUMN" },
          { targetAxis: "LEFT_AXIS", type: "LINE" },
        ],
      },
      { chartType: "LINE", series: [{ targetAxis: "LEFT_AXIS" }, { targetAxis: "LEFT_AXIS" }] },
    ])
  })

  test("rebuilds the series from a new range on the data's tab, keeping the legend, stacking and axes, and the header the chart has", async () => {
    const { body, result } = await send([{ op: "chart_update", chart: 501, range: "A1:D20", stacked: true }])

    const { basicChart } = (body.requests[0] as any).updateChartSpec.spec
    expect(basicChart).toEqual({
      chartType: "COLUMN",
      legendPosition: "BOTTOM_LEGEND",
      stackedType: "STACKED",
      axis: SPEND_CHART.spec.basicChart.axis,
      headerCount: 1,
      domains: [{ domain: column(0, 20) }],
      series: [1, 2, 3].map((index) => ({ series: column(index, 20), targetAxis: "LEFT_AXIS" })),
    })
    expect(result.applied).toEqual(['chart_update "Spend": data Plan!A1:D20, stacked'])
  })

  test("sets the header of a chart it does not rebuild", async () => {
    const { body, result } = await send([{ op: "chart_update", chart: 501, header: false }])

    expect((body.requests[0] as any).updateChartSpec.spec.basicChart.headerCount).toBe(0)
    expect(result.applied).toEqual(['chart_update "Spend": no header row'])
  })

  test("plans a later operation on the title an earlier one gave the chart", async () => {
    const { body } = await send([
      { op: "chart_update", chart: 502, title: "Slices" },
      { op: "chart_update", chart: "slices", legend: "left" },
    ])

    expect((body.requests[1] as any).updateChartSpec.spec).toMatchObject({
      title: "Slices",
      pieChart: { legendPosition: "LEFT_LEGEND" },
    })
  })

  test.each([
    ["no change", { chart: 501 }, "Give `range`"],
    ["a pie chart turned into a column chart", { chart: 502, chart_type: "column" }, "turn into or out of a pie chart"],
    ["a column chart turned into a pie chart", { chart: 501, chart_type: "pie" }, "turn into or out of a pie chart"],
    ["a pie chart's header without a range", { chart: 502, header: false }, "goes with `range`"],
    ["stacking a pie chart", { chart: 502, stacked: true }, "pie chart cannot be stacked"],
    ["stacking a line chart", { chart: 501, chart_type: "line", stacked: true }, "`stacked` goes with"],
    ["a pie chart's range of three columns", { chart: 502, range: "Plan!A1:C13" }, "two columns"],
    ["a range of one column", { chart: 501, range: "A1:A13" }, "label column"],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refused([{ op: "chart_update", ...operation }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_restructure: chart lookup", () => {
  test("refuses a title two charts share, and names the charts, by id or title", async () => {
    const error = await refused([{ op: "chart_delete", chart: "Spend" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Several charts match "Spend"')
    expect(error.message).toContain('"Spend", "Spend", "Share"')
  })

  test("refuses a chart the spreadsheet lacks, and a chart on a tab the call deleted", async () => {
    expect((await refused([{ op: "chart_delete", chart: "Nope" }])).message).toContain('No chart matches "Nope"')
    expect((await refused([{ op: "chart_delete", chart: 999 }])).message).toContain('No chart matches "999"')

    const gone = await refused([
      { op: "tab_delete", tab: "My Tab" },
      { op: "chart_delete", chart: 503 },
    ])
    expect(gone.message).toContain('No chart matches "503"')
  })
})

describe("google_sheets_restructure: chart_move", () => {
  test("moves the chart to a cell, keeps the size that is not given, and sets the offsets back to 0", async () => {
    const { body, result } = await send([{ op: "chart_move", chart: 501, at: "Plan!H2", width: 800 }])

    expect(body.requests).toEqual([
      {
        updateEmbeddedObjectPosition: {
          objectId: 501,
          fields: "anchorCell,offsetXPixels,offsetYPixels,widthPixels,heightPixels",
          newPosition: {
            overlayPosition: {
              anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: 7 },
              widthPixels: 800,
              heightPixels: 371,
              offsetXPixels: 0,
              offsetYPixels: 0,
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual(['chart_move "Spend" to Plan!H2, 800x…px'])
  })

  test("moves a chart to another tab, naming both tabs, and a chart of a tab of its own to a cell at the default size", async () => {
    const { body, result } = await send([
      { op: "chart_move", chart: "share", at: "'My Tab'!B2" },
      { op: "chart_move", chart: 503, at: "B2" },
    ])

    expect((body.requests[0] as any).updateEmbeddedObjectPosition.newPosition.overlayPosition).toMatchObject({
      anchorCell: { sheetId: 77, rowIndex: 1, columnIndex: 1 },
      widthPixels: 400,
      heightPixels: 300,
    })
    expect((body.requests[1] as any).updateEmbeddedObjectPosition.newPosition.overlayPosition).toMatchObject({
      anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: 1 },
      widthPixels: 600,
      heightPixels: 371,
    })
    expect(result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("resizes a chart where it is, changing only the sides given", async () => {
    const { body, result } = await send([{ op: "chart_move", chart: 501, height: 500 }])

    expect(body.requests).toEqual([
      {
        updateEmbeddedObjectPosition: {
          objectId: 501,
          fields: "heightPixels",
          newPosition: { overlayPosition: { heightPixels: 500 } },
        },
      },
    ])
    expect(result.applied).toEqual(['chart_move "Spend": size …x500px'])
  })

  test("puts a chart on a tab of its own, with no fields mask", async () => {
    const { body, result } = await send([{ op: "chart_move", chart: 502, new_tab: true }])

    expect(body.requests).toEqual([
      { updateEmbeddedObjectPosition: { objectId: 502, newPosition: { newSheet: true } } },
    ])
    expect(result.applied).toEqual(['chart_move "Share" on a new tab of its own'])
  })

  test.each([
    ["nothing to change", { chart: 501 }, "Give `at`"],
    ["at and new_tab", { chart: 501, at: "H2", new_tab: true }, "not both"],
    ["a size on a tab of its own", { chart: 501, new_tab: true, width: 300 }, "takes no `width` or `height`"],
    ["an anchor of more than one cell", { chart: 501, at: "H2:I3" }, "`at` is one cell"],
    ["a size for a chart on a tab of its own", { chart: 503, width: 300 }, "is on a tab of its own"],
  ])("refuses %s, and sends nothing", async (_name, operation, message) => {
    const error = await refused([{ op: "chart_move", ...operation }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_restructure: chart_delete", () => {
  test("deletes a chart by title or by id, saying which kind it is and where, and changes no cell", async () => {
    const { body, result } = await send([
      { op: "chart_delete", chart: "share" },
      { op: "chart_delete", chart: 503 },
    ])

    expect(body.requests).toEqual([
      { deleteEmbeddedObject: { objectId: 502 } },
      { deleteEmbeddedObject: { objectId: 503 } },
    ])
    expect(result.applied).toEqual([
      'chart_delete "Share" (pie chart on Plan)',
      "chart_delete \"Spend\" (line chart on 'My Tab')",
    ])
    expect(result.tabs).toEqual(["Plan", "My Tab"])
  })

  test("refuses a chart the call already deleted", async () => {
    const error = await refused([
      { op: "chart_delete", chart: 502 },
      { op: "chart_update", chart: 502, title: "x" },
    ])

    expect(error.message).toContain('No chart matches "502"')
  })
})
