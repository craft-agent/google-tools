import { z } from "zod"
import { ToolError } from "../errors"
import { gridRangeA1, type GridBounds } from "./a1"
import { colorArg, normalizedColor, toColorStyle } from "./colors"
import { conditionOf, fewValues, listValues, plainValues } from "./conditions"
import { columnIndex, type GridRange, type ResolvedRange } from "./grid"
import { findTableState, type ColumnProperty, type TableState } from "./objects"
import { defineOperation, type OperationContext } from "./operations"
import { areaLabel, areasOf, columnLetterArg, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"
import { tabWithId } from "./operations.tabs"
import { shownRange } from "./tabs"

const MAX_TABLE_COLUMNS = 500
const MAX_NAME_LENGTH = 100

/** Google's column types, which `type` takes as they are. */
const COLUMN_TYPES = [
  "TEXT",
  "DOUBLE",
  "CURRENCY",
  "PERCENT",
  "DATE",
  "TIME",
  "DATE_TIME",
  "BOOLEAN",
  "DROPDOWN",
  "FILES_CHIP",
  "PEOPLE_CHIP",
  "FINANCE_CHIP",
  "PLACE_CHIP",
  "RATINGS_CHIP",
] as const

/** The type whose column offers a dropdown of the options in `values`. */
const DROPDOWN = "DROPDOWN"

const tableColumnSchema = z
  .strictObject({
    column: columnLetterArg.describe("The column's letter, which lies in the table's range."),
    type: z.enum(COLUMN_TYPES).optional().describe("Google's column type, such as `TEXT`, `DOUBLE` or `DROPDOWN`."),
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional().describe("The column's name, shown in the header."),
    values: listValues.optional().describe(`The dropdown's options, with type ${DROPDOWN}.`),
  })
  .refine((column) => column.type !== undefined || column.name !== undefined, {
    message: "A table column needs a `type` or a `name`.",
  })
  .refine((column) => column.values === undefined || column.type === DROPDOWN, {
    message: `A table column's \`values\` (dropdown options) need type ${DROPDOWN}.`,
  })

type TableColumns = z.output<typeof tableColumnSchema>[]

/** The arguments `table` and `table_update` share. */
const tableFields = {
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional().describe("The table's name."),
  table_columns: z
    .array(tableColumnSchema)
    .max(MAX_TABLE_COLUMNS)
    .optional()
    .describe(
      "The columns to type or name, each `{ column, type?, name?, values? }`; a column left out keeps what it has.",
    ),
  header_color: colorArg.optional().describe("The header row's color, `#rrggbb`."),
  band_colors: z
    .array(colorArg)
    .min(1)
    .max(2)
    .optional()
    .describe("The color of the alternating rows: one color, or two for the first and the second."),
  footer_color: colorArg.optional().describe("The footer row's color, `#rrggbb`."),
}

type TableFields = z.output<z.ZodObject<typeof tableFields>>

const tableSchema = z.strictObject({
  op: z.literal("table"),
  range: rangeText.describe("The table's range, a closed block with its header row (`Plan!A1:E20`)."),
  ...tableFields,
})

const tableUpdateSchema = z
  .strictObject({
    op: z.literal("table_update"),
    table: rangeText.describe("The table's id or its name."),
    range: rangeText
      .optional()
      .describe("The table's new range, a closed block with its header row; no tab means the table's own tab."),
    ...tableFields,
  })
  .refine(
    (op) =>
      op.range !== undefined ||
      op.name !== undefined ||
      (op.table_columns?.length ?? 0) > 0 ||
      op.header_color !== undefined ||
      op.band_colors !== undefined ||
      op.footer_color !== undefined,
    { message: "Give `range`, `name`, `table_columns` or a color to change." },
  )

const tableDeleteSchema = z.strictObject({
  op: z.literal("table_delete"),
  table: rangeText.describe("The table's id or its name."),
})

/** The area of a table's range, refused unless it is a closed block, which has its header row at the top. */
function closedBlock(area: ResolvedRange, text: string): ResolvedRange {
  const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = area.grid
  if ([startRowIndex, endRowIndex, startColumnIndex, endColumnIndex].includes(undefined)) {
    throw new ToolError(
      "invalid_argument",
      `A table's range is a closed block with its header row, such as 'Plan!A1:E20', not ${JSON.stringify(shownRange(text))}.`,
    )
  }
  return area
}

/** Whether the two blocks share a cell; a bound left open reaches the end of the tab. */
function overlaps(a: GridBounds, b: GridBounds): boolean {
  const apart = (aStart = 0, aEnd = Infinity, bStart = 0, bEnd = Infinity) => aEnd <= bStart || bEnd <= aStart
  return (
    !apart(a.startRowIndex, a.endRowIndex, b.startRowIndex, b.endRowIndex) &&
    !apart(a.startColumnIndex, a.endColumnIndex, b.startColumnIndex, b.endColumnIndex)
  )
}

/** Refuses a range that shares a cell with a table of the spreadsheet other than `own`, an earlier operation's table included. */
function requireNoOverlap(context: OperationContext, area: ResolvedRange, own?: TableState): void {
  const clash = context.objects.tables.find(
    (table) => table !== own && table.sheetId === area.tab.sheetId && overlaps(table.range, area.grid),
  )
  if (clash !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(areaLabel(area))} overlaps the table ${JSON.stringify(clash.name)} (${gridRangeA1(area.tab.title, clash.range)}); a table cannot overlap another.`,
    )
  }
}

/** Refuses a column that lies outside the block, naming `where`. */
function requireColumnsIn(columns: TableColumns | undefined, range: GridBounds, where: string): void {
  const start = range.startColumnIndex ?? 0
  const end = range.endColumnIndex
  const outside = (columns ?? []).filter((column) => {
    const index = columnIndex(column.column)
    return index < start || (end !== undefined && index >= end)
  })
  if (outside.length > 0) {
    const letters = outside.map((column) => column.column.toUpperCase()).join(", ")
    throw new ToolError("invalid_argument", `Column ${letters} is outside ${where}.`)
  }
}

/**
 * The column properties of a table over `range`: the existing ones (counted
 * from `oldFirst`, the table's first column before it moves) re-based and
 * trimmed to the range, then the operation's changes on top. A column new to
 * the table that is not named keeps its header cell's text as its name, since
 * Google would otherwise overwrite that cell with a default name; `header`
 * reads that row.
 */
function columnProperties(
  columns: TableColumns | undefined,
  range: GridBounds,
  existing: readonly ColumnProperty[],
  oldFirst: number | undefined,
  header: () => readonly string[],
): ColumnProperty[] {
  const first = range.startColumnIndex ?? 0
  const width = range.endColumnIndex === undefined ? undefined : range.endColumnIndex - first
  const shift = oldFirst === undefined ? 0 : oldFirst - first
  const properties = new Map<number, ColumnProperty>()
  for (const property of existing) {
    const index = (property.columnIndex ?? 0) + shift
    if (index >= 0 && (width === undefined || index < width)) properties.set(index, { ...property, columnIndex: index })
  }
  let heading: readonly string[] | undefined
  for (const column of columns ?? []) {
    const index = columnIndex(column.column) - first
    if (!properties.has(index) && column.name === undefined) {
      heading ??= header()
      const text = heading[index]?.trim()
      if (text) properties.set(index, { columnIndex: index, columnName: text })
    }
    const property = properties.get(index) ?? { columnIndex: index }
    properties.set(index, property)
    if (column.type !== undefined) {
      property.columnType = column.type
      if (column.type !== DROPDOWN) delete property.dataValidationRule
    }
    if (column.name !== undefined) property.columnName = column.name
    if (column.values !== undefined) {
      property.dataValidationRule = { condition: conditionOf("ONE_OF_LIST", plainValues(column.values), true) }
    }
  }
  return [...properties].sort(([a], [b]) => a - b).map(([, property]) => property)
}

/** Google's `rowsProperties` for the colors given. */
function rowsProperties(op: TableFields): Record<string, unknown> {
  const [first, second] = op.band_colors ?? []
  return {
    ...(op.header_color !== undefined && { headerColorStyle: toColorStyle(op.header_color) }),
    ...(op.footer_color !== undefined && { footerColorStyle: toColorStyle(op.footer_color) }),
    ...(first !== undefined && { firstBandColorStyle: toColorStyle(first) }),
    ...(second !== undefined && { secondBandColorStyle: toColorStyle(second) }),
  }
}

/** The columns and colors an operation sets, as a description shows them. */
function tableWords(op: TableFields): string[] {
  const columns = (op.table_columns ?? []).map((column) => {
    const name = column.name === undefined ? "" : ` ${JSON.stringify(column.name)}`
    const options = column.values !== undefined && column.values.length > 0 ? plainValues(column.values) : undefined
    const kind = options === undefined ? (column.type ?? "") : `dropdown (${fewValues(options)})`
    return `${column.column.toUpperCase()}${name} ${kind}`.trimEnd()
  })
  const colors = [
    ...(op.header_color === undefined ? [] : [`header ${normalizedColor(op.header_color)}`]),
    ...(op.footer_color === undefined ? [] : [`footer ${normalizedColor(op.footer_color)}`]),
    ...(op.band_colors === undefined ? [] : [`bands ${op.band_colors.map(normalizedColor).join("/")}`]),
  ]
  return [...columns, ...colors]
}

/** A header that reads nothing and notes that it was asked for, so an operation can tell whether its plan needs the row. */
function probe(): { header: () => readonly string[]; asked: () => boolean } {
  let asked = false
  return {
    header: () => {
      asked = true
      return []
    },
    asked: () => asked,
  }
}

/** The row of the block that names its columns, as an area to read. */
function headerRow(tab: ResolvedRange["tab"], range: GridRange): ResolvedRange {
  return { tab, grid: { ...range, endRowIndex: (range.startRowIndex ?? 0) + 1 } }
}

/** The name a new table gets: the one given, else `Table` and the first number no table of the spreadsheet has taken. */
function newTableName(op: TableFields, context: OperationContext): string {
  if (op.name !== undefined) return op.name
  const names = new Set(context.objects.tables.map((table) => table.name))
  let number = names.size + 1
  while (names.has(`Table${number}`)) number++
  return `Table${number}`
}

/** The block of a new table, checked to be closed and free of other tables. */
function newTableArea(op: { range: string }, context: OperationContext, columns: TableColumns | undefined) {
  const area = closedBlock(areasOf(op, context.tabs)[0]!, op.range)
  requireNoOverlap(context, area)
  requireColumnsIn(columns, area.grid, "the table's range")
  return area
}

/** `table`: makes a native table of a block of cells; it never overlaps another table. */
export const tableOperation = defineOperation({
  schema: tableSchema,
  needs: ["objects"],
  reads(op, context) {
    const area = newTableArea(op, context, op.table_columns)
    const reading = probe()
    columnProperties(op.table_columns, area.grid, [], undefined, reading.header)
    return reading.asked() ? { header: headerRow(area.tab, area.grid) } : {}
  },
  requests(op, context) {
    const area = newTableArea(op, context, op.table_columns)
    const name = newTableName(op, context)
    const columns = columnProperties(
      op.table_columns,
      area.grid,
      [],
      undefined,
      () => context.read.get(op)?.header ?? [],
    )
    const rows = rowsProperties(op)
    const { sheetId, ...bounds } = area.grid
    context.objects.tables.push({ sheetId, name, range: bounds, columns })
    return [
      {
        addTable: {
          table: {
            name,
            range: area.grid,
            ...(columns.length > 0 && { columnProperties: columns }),
            ...(Object.keys(rows).length > 0 && { rowsProperties: rows }),
          },
        },
      },
    ]
  },
  tabs: (op, context) => tabsOfAreas([newTableArea(op, context, op.table_columns)]),
  describe(op, context) {
    const area = newTableArea(op, context, op.table_columns)
    const words = tableWords(op)
    return `table ${JSON.stringify(newTableName(op, context))} on ${areaLabel(area)}${words.length > 0 ? `: ${words.join(", ")}` : ""}`
  },
})

/** What `table_update` works out before it changes anything: the table, its new block, and the column properties it will have. */
function resolveUpdate(
  op: z.output<typeof tableUpdateSchema>,
  context: OperationContext,
  header: () => readonly string[],
) {
  const current = findTableState(context.tabs, context.objects, op.table)
  const own = tabWithId(context.tabs, current.sheetId)
  const area = op.range === undefined ? undefined : closedBlock(resolveOn(context.tabs, op.range, own), op.range)
  if (area !== undefined) requireNoOverlap(context, area, current)
  const range: GridRange = area?.grid ?? { sheetId: current.sheetId, ...current.range }
  requireColumnsIn(op.table_columns, range, `table ${JSON.stringify(current.name)}`)
  const columns = columnProperties(
    op.table_columns,
    range,
    current.columns,
    current.range.startColumnIndex ?? 0,
    header,
  )
  return { current, own, area, range, columns }
}

/** `table_update`: changes a table's range, name, columns or colors, touching nothing it does not name. */
export const tableUpdateOperation = defineOperation({
  schema: tableUpdateSchema,
  needs: ["objects"],
  reads(op, context) {
    const reading = probe()
    const { own, area, range } = resolveUpdate(op, context, reading.header)
    return reading.asked() ? { header: headerRow(area?.tab ?? own, range) } : {}
  },
  requests(op, context) {
    const { current, area, range, columns } = resolveUpdate(op, context, () => context.read.get(op)?.header ?? [])
    const rows = rowsProperties(op)
    const withColumns = (op.table_columns?.length ?? 0) > 0
    const fields = [
      ...(area === undefined ? [] : ["range"]),
      ...(op.name === undefined ? [] : ["name"]),
      ...(withColumns ? ["columnProperties"] : []),
      ...Object.keys(rows).map((field) => `rowsProperties.${field}`),
    ]
    const request = {
      updateTable: {
        table: {
          tableId: current.tableId,
          ...(area !== undefined && { range: area.grid }),
          ...(op.name !== undefined && { name: op.name }),
          ...(withColumns && { columnProperties: columns }),
          ...(Object.keys(rows).length > 0 && { rowsProperties: rows }),
        },
        fields: fields.join(","),
      },
    }
    const { sheetId, ...bounds } = range
    Object.assign(current, { sheetId, range: bounds, columns, ...(op.name !== undefined && { name: op.name }) })
    return [request]
  },
  tabs(op, context) {
    const { own, area } = resolveUpdate(op, context, () => [])
    return tabsOfAreas([{ tab: own, grid: { sheetId: own.sheetId } }, ...(area === undefined ? [] : [area])])
  },
  describe(op, context) {
    const { current, area } = resolveUpdate(op, context, () => [])
    const words = [
      ...(op.name === undefined ? [] : [`rename to ${JSON.stringify(op.name)}`]),
      ...(area === undefined ? [] : [`range ${areaLabel(area)}`]),
      ...tableWords(op),
    ]
    return `table_update ${JSON.stringify(current.name)}: ${words.join(", ")}`
  },
  pins: (op, context) => {
    const { definition } = findTableState(context.tabs, context.objects, op.table)
    return definition === undefined ? [] : [definition]
  },
})

/** `table_delete`: removes a table, which leaves its cells and their values on the tab. */
export const tableDeleteOperation = defineOperation({
  schema: tableDeleteSchema,
  needs: ["objects"],
  requests(op, context) {
    const current = findTableState(context.tabs, context.objects, op.table)
    context.objects.tables = context.objects.tables.filter((table) => table !== current)
    return [{ deleteTable: { tableId: current.tableId } }]
  },
  tabs(op, context) {
    const current = findTableState(context.tabs, context.objects, op.table)
    return [tabWithId(context.tabs, current.sheetId)]
  },
  describe(op, context) {
    const current = findTableState(context.tabs, context.objects, op.table)
    const tab = tabWithId(context.tabs, current.sheetId)
    return `table_delete ${JSON.stringify(current.name)} (${gridRangeA1(tab.title, current.range)}): only the table goes, its cells keep their values`
  },
  pins(op, context) {
    const { definition } = findTableState(context.tabs, context.objects, op.table)
    return definition === undefined ? [] : [definition]
  },
})
