import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { columnLetters, gridRangeA1 } from "./a1"
import { colorOf, colorReply, colorStyleReply } from "./colors"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { CellFormat, FormatResult, FormattedCell, FormattedRange } from "./schemas"
import { tabOfRange, type SheetTab } from "./tabs"

/** The most formatted cells one call returns, across all its ranges. */
export const MAX_FORMAT_CELLS = 2_000

/** The height of a row and the width of a column nobody resized, in pixels; rows and columns of any other size are listed. */
export const DEFAULT_ROW_HEIGHT = 21
export const DEFAULT_COLUMN_WIDTH = 100

const FORMAT_FIELDS =
  "sheets(properties(sheetId,title),data(startRow,startColumn," +
  "rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser)," +
  "rowData(values(userEnteredFormat,note,hyperlink,dataValidation))))"

/** Google's enum names that say nothing was set. */
const UNSPECIFIED = /_UNSPECIFIED$/

const OVERFLOW_STRATEGY = "OVERFLOW_CELL"
const BORDER_NONE = "NONE"
const BLACK = "#000000"

const flag = z.boolean().optional()
const text = z.string().optional()
const pixels = z.number().optional()

const borderReply = z
  .object({ style: text, color: colorReply.optional(), colorStyle: colorStyleReply.optional() })
  .optional()

const cellReply = z.object({
  userEnteredFormat: z
    .object({
      backgroundColor: colorReply.optional(),
      backgroundColorStyle: colorStyleReply.optional(),
      textFormat: z
        .object({
          bold: flag,
          italic: flag,
          underline: flag,
          strikethrough: flag,
          fontFamily: text,
          fontSize: pixels,
          foregroundColor: colorReply.optional(),
          foregroundColorStyle: colorStyleReply.optional(),
        })
        .optional(),
      horizontalAlignment: text,
      verticalAlignment: text,
      wrapStrategy: text,
      numberFormat: z.object({ type: text, pattern: text }).optional(),
      textRotation: z.object({ angle: pixels, vertical: flag }).optional(),
      padding: z.object({ top: pixels, right: pixels, bottom: pixels, left: pixels }).optional(),
      borders: z.object({ top: borderReply, bottom: borderReply, left: borderReply, right: borderReply }).optional(),
    })
    .optional(),
  note: text,
  hyperlink: text,
  dataValidation: z
    .object({
      condition: z
        .object({
          type: text,
          values: z.array(z.object({ userEnteredValue: text, relativeDate: text })).optional(),
        })
        .optional(),
      strict: flag,
      showCustomUi: flag,
    })
    .optional(),
})

const lineReply = z.object({ pixelSize: pixels, hiddenByUser: flag })

const dataReply = z.object({
  startRow: pixels,
  startColumn: pixels,
  rowMetadata: z.array(lineReply).optional(),
  columnMetadata: z.array(lineReply).optional(),
  rowData: z.array(z.object({ values: z.array(cellReply).optional() })).optional(),
})

const formatReply = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: pixels, title: text }).optional(),
        data: z.array(dataReply).optional(),
      }),
    )
    .optional(),
})

type CellReply = z.output<typeof cellReply>
type DataReply = z.output<typeof dataReply>

/** An enum name of Google's as a lower-case word (`DATE_TIME` is `date_time`), `undefined` when it names nothing. */
function word(name: string | undefined): string | undefined {
  return name === undefined || UNSPECIFIED.test(name) ? undefined : name.toLowerCase()
}

/** The compact, snake_case view of a cell's `userEnteredFormat`: only what is set, in the words the `format` operation takes. */
function formatView(format: NonNullable<CellReply["userEnteredFormat"]>): CellFormat {
  const view: CellFormat = {}
  const { textFormat, numberFormat, textRotation, padding } = format
  for (const key of ["bold", "italic", "underline", "strikethrough"] as const) {
    if (textFormat?.[key] !== undefined) view[key] = textFormat[key]
  }
  if (textFormat?.fontSize !== undefined) view.font_size = textFormat.fontSize
  if (textFormat?.fontFamily !== undefined) view.font = textFormat.fontFamily
  const color = colorOf(textFormat?.foregroundColorStyle) ?? colorOf(textFormat?.foregroundColor)
  if (color !== undefined) view.color = color
  const background = colorOf(format.backgroundColorStyle) ?? colorOf(format.backgroundColor)
  if (background !== undefined) view.background = background
  const horizontal = word(format.horizontalAlignment)
  if (horizontal !== undefined) view.horizontal_align = horizontal
  const vertical = word(format.verticalAlignment)
  if (vertical !== undefined) view.vertical_align = vertical
  const wrap = format.wrapStrategy === OVERFLOW_STRATEGY ? "overflow" : word(format.wrapStrategy)
  if (wrap !== undefined) view.wrap = wrap
  const numberType = word(numberFormat?.type)
  if (numberType !== undefined) {
    view.number_format = {
      type: numberType,
      ...(numberFormat?.pattern !== undefined && { pattern: numberFormat.pattern }),
    }
  }
  if (textRotation?.vertical === true) view.rotation = "vertical"
  else if (textRotation?.angle !== undefined) view.rotation = textRotation.angle
  if (padding !== undefined && Object.keys(padding).length > 0) {
    view.padding = {
      top: padding.top ?? 0,
      right: padding.right ?? 0,
      bottom: padding.bottom ?? 0,
      left: padding.left ?? 0,
    }
  }
  const borders = Object.entries(format.borders ?? {}).flatMap(([side, border]) =>
    border?.style === undefined || border.style === BORDER_NONE || UNSPECIFIED.test(border.style)
      ? []
      : [
          [
            side,
            { style: border.style.toLowerCase(), color: colorOf(border.colorStyle) ?? colorOf(border.color) ?? BLACK },
          ],
        ],
  )
  if (borders.length > 0) view.borders = Object.fromEntries(borders)
  return view
}

/** The cell as the result lists it, or `undefined` for a cell that carries no format, note, link or validation. */
function formattedCell(address: string, cell: CellReply): FormattedCell | undefined {
  const format = cell.userEnteredFormat === undefined ? {} : formatView(cell.userEnteredFormat)
  const rule = cell.dataValidation
  const note = cell.note === undefined || cell.note === "" ? null : cell.note
  const link = cell.hyperlink === undefined || cell.hyperlink === "" ? null : cell.hyperlink
  if (Object.keys(format).length === 0 && note === null && link === null && rule === undefined) return undefined
  return {
    cell: address,
    format: Object.keys(format).length === 0 ? null : format,
    note,
    link,
    validation:
      rule === undefined
        ? null
        : {
            condition: rule.condition?.type ?? "",
            values: (rule.condition?.values ?? []).map((value) => value.userEnteredValue ?? value.relativeDate ?? ""),
            strict: rule.strict ?? false,
            dropdown: rule.showCustomUi ?? false,
          },
  }
}

/** One range as Google returned it: its A1 range, the rows and columns that are hidden or not of the default size, and every cell that carries anything. */
function formattedBlock(title: string, data: DataReply, asked: string): Omit<FormattedRange, "truncated"> {
  const top = data.startRow ?? 0
  const left = data.startColumn ?? 0
  const rowData = data.rowData ?? []
  const rowLines = data.rowMetadata ?? []
  const columnLines = data.columnMetadata ?? []
  const height = Math.max(rowData.length, rowLines.length, 1)
  const width = Math.max(columnLines.length, ...rowData.map((row) => row.values?.length ?? 0), 1)
  return {
    range:
      rowData.length + rowLines.length + columnLines.length === 0
        ? asked
        : gridRangeA1(title, {
            startRowIndex: top,
            endRowIndex: top + height,
            startColumnIndex: left,
            endColumnIndex: left + width,
          }),
    rows: rowLines.flatMap((line, position) => {
      const hidden = line.hiddenByUser ?? false
      const size = line.pixelSize ?? null
      return hidden || (size !== null && size !== DEFAULT_ROW_HEIGHT)
        ? [{ row: top + position + 1, height: size, hidden }]
        : []
    }),
    columns: columnLines.flatMap((line, position) => {
      const hidden = line.hiddenByUser ?? false
      const size = line.pixelSize ?? null
      return hidden || (size !== null && size !== DEFAULT_COLUMN_WIDTH)
        ? [{ column: columnLetters(left + position), width: size, hidden }]
        : []
    }),
    cells: rowData.flatMap((row, rowPosition) =>
      (row.values ?? []).flatMap((cell, columnPosition) => {
        const listed = formattedCell(`${columnLetters(left + columnPosition)}${top + rowPosition + 1}`, cell)
        return listed === undefined ? [] : [listed]
      }),
    ),
  }
}

/**
 * The formatting of each range: its hidden or resized rows and columns and
 * every cell that carries a format, note, link or validation, never a value.
 * One shared budget of `MAX_FORMAT_CELLS` cells applies to the ranges in
 * order; a range that has more is `truncated`, and so is every later range
 * that has any.
 */
export async function readFormat(client: GoogleClient, id: string, ranges: readonly string[]): Promise<FormatResult> {
  const reply = parseReply(
    formatReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: { ranges, includeGridData: true, fields: FORMAT_FIELDS },
    }),
    "the formatting",
  )
  // Google answers the tabs in their order and, for each, its ranges in the order asked: pair them back up.
  const sheets = reply.sheets ?? []
  const tabs: SheetTab[] = sheets.map((sheet, index) => ({
    sheetId: sheet.properties?.sheetId ?? 0,
    title: sheet.properties?.title ?? "",
    index,
    tables: [],
  }))
  const pending = new Map(tabs.map((tab, index) => [tab.sheetId, [...(sheets[index]?.data ?? [])]]))
  let remaining = MAX_FORMAT_CELLS
  const formatted = ranges.map((asked): FormattedRange => {
    const tab = tabOfRange(tabs, asked)
    const block = formattedBlock(tab.title, pending.get(tab.sheetId)?.shift() ?? {}, asked)
    const cells = block.cells.slice(0, remaining)
    remaining -= cells.length
    return { ...block, cells, truncated: cells.length < block.cells.length }
  })
  return { spreadsheet_id: id, formats: formatted }
}
