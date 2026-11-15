import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { columnLetters, quoteTab, type GridBounds } from "./a1"
import { colorReply, colorStyleReply } from "./colors"
import { conditionText } from "./conditions"
import { areaLabel } from "./operation-ranges"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { StructureResult, StructuredTab } from "./schemas"
import { criteriaSummaries, ruleSummary, type FilterSpecReply } from "./structure-summaries"
import { tabOfRange, type SheetTab } from "./tabs"

/** The most entries of each list a tab's structure returns; the rest are counted in `more`. */
export const MAX_STRUCTURE_ENTRIES = 50

const STRUCTURE_FIELDS =
  "sheets(properties(sheetId,title,index),merges," +
  "tables(tableId,name,range,columnProperties(columnIndex,columnName,columnType,dataValidationRule(condition)))," +
  "conditionalFormats(ranges,booleanRule(condition,format),gradientRule)," +
  "rowGroups(range,depth,collapsed),columnGroups(range,depth,collapsed),basicFilter(range,filterSpecs)," +
  "filterViews(filterViewId,title,range,filterSpecs)," +
  "charts(chartId,spec(title,basicChart(chartType),pieChart(legendPosition)),position)," +
  "protectedRanges(protectedRangeId,range,description,warningOnly,editors(users)))"

/** The type of a table column Google reports no type for. */
const DEFAULT_COLUMN_TYPE = "TEXT"

/** The type a pie chart is listed as: Google gives it no basic chart type, only a spec of its own. */
const PIE_CHART = "PIE"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const gridReply = z.object({
  startRowIndex: gridNumber,
  endRowIndex: gridNumber,
  startColumnIndex: gridNumber,
  endColumnIndex: gridNumber,
})

const groupReply = z.object({
  range: z.object({ startIndex: gridNumber, endIndex: gridNumber }).optional(),
  depth: z.number().optional(),
  collapsed: z.boolean().optional(),
})

const conditionReply = z.object({
  type: z.string().optional(),
  values: z
    .array(z.object({ userEnteredValue: z.string().optional(), relativeDate: z.string().optional() }))
    .optional(),
})

const gradientPointReply = z.object({ color: colorReply.optional(), colorStyle: colorStyleReply.optional() })

const filterSpecsReply = z
  .array(
    z.object({
      columnIndex: gridNumber,
      filterCriteria: z
        .object({ hiddenValues: z.array(z.string()).optional(), condition: conditionReply.optional() })
        .optional(),
    }),
  )
  .optional()

const structureReply = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: gridNumber, title: z.string().optional(), index: gridNumber }).optional(),
        merges: z.array(gridReply).optional(),
        tables: z
          .array(
            z.object({
              tableId: z.string().optional(),
              name: z.string().optional(),
              range: gridReply.optional(),
              columnProperties: z
                .array(
                  z.object({
                    columnIndex: gridNumber,
                    columnName: z.string().optional(),
                    columnType: z.string().optional(),
                    dataValidationRule: z.object({ condition: conditionReply.optional() }).optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
        conditionalFormats: z
          .array(
            z.object({
              ranges: z.array(gridReply).optional(),
              booleanRule: z
                .object({
                  condition: conditionReply.optional(),
                  format: z
                    .object({
                      textFormat: z
                        .object({
                          bold: z.boolean().optional(),
                          italic: z.boolean().optional(),
                          strikethrough: z.boolean().optional(),
                          foregroundColor: colorReply.optional(),
                          foregroundColorStyle: colorStyleReply.optional(),
                        })
                        .optional(),
                      backgroundColor: colorReply.optional(),
                      backgroundColorStyle: colorStyleReply.optional(),
                    })
                    .optional(),
                })
                .optional(),
              gradientRule: z
                .object({
                  minpoint: gradientPointReply.optional(),
                  midpoint: gradientPointReply.optional(),
                  maxpoint: gradientPointReply.optional(),
                })
                .optional(),
            }),
          )
          .optional(),
        rowGroups: z.array(groupReply).optional(),
        columnGroups: z.array(groupReply).optional(),
        basicFilter: z.object({ range: gridReply.optional(), filterSpecs: filterSpecsReply }).optional(),
        filterViews: z
          .array(
            z.object({
              filterViewId: gridNumber,
              title: z.string().optional(),
              range: gridReply.optional(),
              filterSpecs: filterSpecsReply,
            }),
          )
          .optional(),
        charts: z
          .array(
            z.object({
              chartId: gridNumber,
              spec: z
                .object({
                  title: z.string().optional(),
                  basicChart: z.object({ chartType: z.string().optional() }).optional(),
                  pieChart: z.record(z.string(), z.unknown()).optional(),
                })
                .optional(),
              position: z
                .object({
                  overlayPosition: z
                    .object({ anchorCell: z.object({ rowIndex: gridNumber, columnIndex: gridNumber }).optional() })
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
        protectedRanges: z
          .array(
            z.object({
              protectedRangeId: gridNumber,
              range: gridReply.optional(),
              description: z.string().optional(),
              warningOnly: z.boolean().optional(),
              editors: z.object({ users: z.array(z.string()).optional() }).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

type SheetReply = NonNullable<z.output<typeof structureReply>["sheets"]>[number]
type GroupReply = z.output<typeof groupReply>

/** A range of the tab in A1 notation, tab included; a single cell is `Plan!B2`, not `Plan!B2:B2`, and the whole tab is its title. */
function rangeA1(title: string, bounds: GridBounds = {}): string {
  return areaLabel({ tab: { title }, grid: bounds })
}

/** The first `MAX_STRUCTURE_ENTRIES` entries of a list, and how many more there are. */
function capped<T>(entries: readonly T[] | undefined): { shown: T[]; more: number } {
  const all = entries ?? []
  return { shown: all.slice(0, MAX_STRUCTURE_ENTRIES), more: Math.max(all.length - MAX_STRUCTURE_ENTRIES, 0) }
}

/** The group as the result lists it: its rows or columns in A1 notation with the tab, its depth and whether it is collapsed. */
function groupView(
  title: string,
  dimension: "rows" | "columns",
  group: GroupReply,
): StructuredTab["row_groups"][number] {
  const start = group.range?.startIndex ?? 0
  const end = group.range?.endIndex ?? 0
  const bounds: GridBounds =
    dimension === "rows" ? { startRowIndex: start, endRowIndex: end } : { startColumnIndex: start, endColumnIndex: end }
  return { range: rangeA1(title, bounds), depth: group.depth ?? 1, collapsed: group.collapsed ?? false }
}

/** The criteria of a filter, one entry per column, cut to `MAX_STRUCTURE_ENTRIES` with the rest counted in a last entry. */
function cappedCriteria(specs: readonly FilterSpecReply[] | undefined): string[] {
  const { shown, more } = capped(criteriaSummaries(specs))
  return more > 0 ? [...shown, `+${more} more`] : shown
}

/** The table's columns, left to right as the tab counts them, cut to `MAX_STRUCTURE_ENTRIES`. */
function tableColumns(table: NonNullable<SheetReply["tables"]>[number]): {
  columns: StructuredTab["tables"][number]["columns"]
  more_columns: number
} {
  const first = table.range?.startColumnIndex ?? 0
  const { shown, more } = capped(table.columnProperties)
  return {
    columns: shown.map((column) => {
      const options = (column.dataValidationRule?.condition?.values ?? []).flatMap((value) =>
        value.userEnteredValue === undefined ? [] : [value.userEnteredValue],
      )
      return {
        column: columnLetters(first + (column.columnIndex ?? 0)),
        name: column.columnName ?? "",
        type: column.columnType ?? DEFAULT_COLUMN_TYPE,
        ...(options.length > 0 && { options }),
      }
    }),
    more_columns: more,
  }
}

/** The tab's merges, groups, tables, rules, filters, charts and protections, each list cut to `MAX_STRUCTURE_ENTRIES`. */
function structuredTab(sheet: SheetReply): StructuredTab {
  const properties = sheet.properties ?? {}
  const title = properties.title ?? ""
  const merges = capped(sheet.merges)
  const rowGroups = capped(sheet.rowGroups)
  const columnGroups = capped(sheet.columnGroups)
  const tables = capped(sheet.tables)
  const rules = capped(sheet.conditionalFormats)
  const views = capped(sheet.filterViews)
  const charts = capped(sheet.charts)
  const protections = capped(sheet.protectedRanges)
  return {
    sheet_id: properties.sheetId ?? 0,
    title,
    merges: merges.shown.map((range) => rangeA1(title, range)),
    row_groups: rowGroups.shown.map((group) => groupView(title, "rows", group)),
    column_groups: columnGroups.shown.map((group) => groupView(title, "columns", group)),
    tables: tables.shown.map((table) => ({
      table_id: table.tableId ?? "",
      name: table.name ?? "",
      range: rangeA1(title, table.range),
      ...tableColumns(table),
    })),
    conditional_rules: rules.shown.map((rule, index) => {
      const style = ruleSummary(rule)
      return {
        index,
        ranges: (rule.ranges ?? []).map((range) => rangeA1(title, range)),
        kind: rule.booleanRule === undefined ? "gradient" : "boolean",
        ...(rule.booleanRule !== undefined && { condition: conditionText(rule.booleanRule.condition) }),
        ...(style !== undefined && { style }),
      }
    }),
    basic_filter:
      sheet.basicFilter === undefined
        ? null
        : {
            range: rangeA1(title, sheet.basicFilter.range),
            criteria: cappedCriteria(sheet.basicFilter.filterSpecs),
          },
    filter_views: views.shown.map((view) => ({
      view_id: view.filterViewId ?? 0,
      title: view.title ?? "",
      range: rangeA1(title, view.range),
      criteria: cappedCriteria(view.filterSpecs),
    })),
    charts: charts.shown.map((chart) => {
      const anchor = chart.position?.overlayPosition?.anchorCell
      const overlay = chart.position?.overlayPosition
      return {
        chart_id: chart.chartId ?? 0,
        title: chart.spec?.title ?? null,
        type: chart.spec?.pieChart === undefined ? (chart.spec?.basicChart?.chartType ?? null) : PIE_CHART,
        anchor:
          overlay === undefined
            ? null
            : `${quoteTab(title)}!${columnLetters(anchor?.columnIndex ?? 0)}${(anchor?.rowIndex ?? 0) + 1}`,
      }
    }),
    protections: protections.shown.map((protection) => ({
      protection_id: protection.protectedRangeId ?? 0,
      range: rangeA1(title, protection.range),
      description: protection.description ?? null,
      warning_only: protection.warningOnly ?? false,
      editors: protection.editors === undefined ? null : (protection.editors.users ?? []),
    })),
    more: {
      merges: merges.more,
      row_groups: rowGroups.more,
      column_groups: columnGroups.more,
      tables: tables.more,
      conditional_rules: rules.more,
      filter_views: views.more,
      charts: charts.more,
      protections: protections.more,
    },
  }
}

/**
 * The structure of a spreadsheet's tabs, in one read: what merges, groups,
 * tables, conditional rules, filters, charts and protections each has, in A1
 * notation with the tab and with the ids that name them; no cell values. `titles`
 * picks the tabs (every tab when left out), a title the spreadsheet lacks being
 * `invalid_argument`.
 */
export async function readStructure(
  client: GoogleClient,
  id: string,
  titles: readonly string[] | undefined,
): Promise<StructureResult> {
  const reply = parseReply(
    structureReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { fields: STRUCTURE_FIELDS },
    }),
    "the structure",
  )
  const sheets = reply.sheets ?? []
  const tabs: SheetTab[] = sheets.map((sheet, index) => ({
    sheetId: sheet.properties?.sheetId ?? 0,
    title: sheet.properties?.title ?? "",
    index,
    hidden: false,
    tables: [],
  }))
  const picked =
    titles === undefined ? undefined : new Set(titles.map((title) => tabOfRange(tabs, quoteTab(title)).sheetId))
  return {
    spreadsheet_id: id,
    structure: sheets
      .filter((sheet) => picked === undefined || picked.has(sheet.properties?.sheetId ?? 0))
      .map(structuredTab),
  }
}
