import { SPREADSHEET } from "./write.testing"

/** Fixtures the chart and pivot table tests share, on top of the structure fixtures. */

/** The block of the tab `Plan` (id 0) that a chart's source names, one column wide. */
export const COLUMN_OF = (index: number, endRowIndex = 13, startRowIndex = 0) => ({
  startRowIndex,
  endRowIndex,
  startColumnIndex: index,
  endColumnIndex: index + 1,
})

const dataOf = (index: number, startRowIndex = 0) => ({
  sourceRange: { sources: [COLUMN_OF(index, 13, startRowIndex)] },
})

/** A column chart of `Plan!A1:C13` titled `Spend`, anchored at E1. */
export const SPEND_CHART = {
  chartId: 501,
  spec: {
    title: "Spend",
    fontName: "Roboto",
    basicChart: {
      chartType: "COLUMN",
      legendPosition: "BOTTOM_LEGEND",
      headerCount: 1,
      axis: [{ position: "BOTTOM_AXIS", title: "Month" }],
      domains: [{ domain: dataOf(0) }],
      series: [
        { series: dataOf(1), targetAxis: "LEFT_AXIS" },
        { series: dataOf(2), targetAxis: "LEFT_AXIS" },
      ],
    },
  },
  position: {
    overlayPosition: {
      anchorCell: { columnIndex: 4 },
      offsetXPixels: 7,
      widthPixels: 600,
      heightPixels: 371,
    },
  },
}

/** A pie chart of `Plan!A2:B13` titled `Share`, anchored at A15. */
export const SHARE_CHART = {
  chartId: 502,
  spec: {
    title: "Share",
    pieChart: { legendPosition: "RIGHT_LEGEND", domain: dataOf(0, 1), series: dataOf(1, 1) },
  },
  position: { overlayPosition: { anchorCell: { rowIndex: 14 }, widthPixels: 400, heightPixels: 300 } },
}

/** A line chart on a tab of its own (`My Tab`, id 77), also titled `Spend`. */
export const OWN_TAB_CHART = {
  chartId: 503,
  spec: { title: "Spend", basicChart: { chartType: "LINE", domains: [], series: [] } },
  position: { sheetId: 77 },
}

/** The cell at the top left of a pivot table of `Plan!A1:D100`: its definition as Google reports it. */
export const SALES_PIVOT = {
  source: { startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 4 },
  rows: [{ sourceColumnOffset: 0, showTotals: true, sortOrder: "ASCENDING" }],
  values: [{ sourceColumnOffset: 3, summarizeFunction: "SUM" }],
}

/** `SPREADSHEET` with `Plan` 100 rows by 10 columns, holding the charts `Spend` and `Share`, and `My Tab` holding the one on its own tab. */
export const WITH_CHARTS = {
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.map((sheet) => {
    if (sheet.properties.title === "Plan") {
      return {
        ...sheet,
        properties: { ...sheet.properties, gridProperties: { rowCount: 100, columnCount: 10 } },
        charts: [SPEND_CHART, SHARE_CHART],
      }
    }
    if (sheet.properties.title === "My Tab") {
      return {
        ...sheet,
        properties: { ...sheet.properties, gridProperties: { rowCount: 50, columnCount: 5 } },
        charts: [OWN_TAB_CHART],
      }
    }
    return sheet
  }),
}

/** What the read of the cells answers for one cell that holds a pivot table. */
export const PIVOT_CELL = { sheets: [{ data: [{ rowData: [{ values: [{ pivotTable: SALES_PIVOT }] }] }] }] }

/** What the read of the cells answers for one cell that holds a value. */
export const VALUE_CELL = {
  sheets: [{ data: [{ rowData: [{ values: [{}, { effectiveValue: { stringValue: "x" } }] }] }] }],
}
