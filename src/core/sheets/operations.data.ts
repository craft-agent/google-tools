import { z } from "zod"
import { ToolError } from "../errors"
import { columnIndex } from "./grid"
import { defineOperation } from "./operations"
import { blockAt, closedAreasOf, onlyClosedArea, sizeOf, type ClosedArea } from "./operation-blocks"
import {
  ONE_RANGE_MESSAGE,
  areaLabel,
  columnLetterArg,
  hasOneRange,
  rangeFields,
  rangeText,
  rangesLabel,
  tabsOfAreas,
} from "./operation-ranges"
import type { SheetTab } from "./tabs"

const SORT_ORDERS = ["asc", "desc"] as const
const DEFAULT_SORT_ORDER = "asc"

/** Google's name for each sort order. */
const SORT_ORDER_NAMES = { asc: "ASCENDING", desc: "DESCENDING" } as const satisfies Record<
  (typeof SORT_ORDERS)[number],
  string
>

/** The most keys a sort takes. */
const MAX_SORT_KEYS = 10

/** The most columns a `dedupe` compares. */
const MAX_COMPARE_COLUMNS = 100

/** The most rows or columns an `autofill` extends the source by. */
const MAX_FILL = 10_000

const FILL_DIRECTIONS = ["down", "up", "right", "left"] as const
const DEFAULT_FILL_DIRECTION = "down"

/** The dimension Google fills into for each direction, and the sign of the fill length: positive goes after the source, negative before it. */
const FILL_AXES = {
  down: { dimension: "ROWS", sign: 1 },
  up: { dimension: "ROWS", sign: -1 },
  right: { dimension: "COLUMNS", sign: 1 },
  left: { dimension: "COLUMNS", sign: -1 },
} as const satisfies Record<(typeof FILL_DIRECTIONS)[number], { dimension: string; sign: number }>

/** The delimiters that have a name, each by the words that mean it (the case of a word does not matter), and Google's name for it. */
const DELIMITERS = {
  comma: "COMMA",
  ",": "COMMA",
  semicolon: "SEMICOLON",
  ";": "SEMICOLON",
  period: "PERIOD",
  ".": "PERIOD",
  space: "SPACE",
  " ": "SPACE",
  auto: "AUTODETECT",
} as const satisfies Record<string, string>

const DEFAULT_DELIMITER = "auto"
const CUSTOM_DELIMITER = "CUSTOM"

const headerArg = z
  .boolean()
  .optional()
  .describe("`true` (the default) keeps the range's first row out as a header; `false` includes it.")

/** Google's name for the delimiter the words name, or `undefined` for a text that is no word of `DELIMITERS`. */
function namedDelimiter(text: string): string | undefined {
  const word = text.toLowerCase()
  return Object.hasOwn(DELIMITERS, word) ? DELIMITERS[word as keyof typeof DELIMITERS] : undefined
}

/** The index of the column the letters name, which must lie in the area. */
function columnInside(letters: string, area: ClosedArea, what: string): number {
  const index = columnIndex(letters)
  if (index < area.grid.startColumnIndex || index >= area.grid.endColumnIndex) {
    throw new ToolError(
      "invalid_argument",
      `${what} column ${letters.toUpperCase()} is outside the range ${areaLabel(area)}.`,
    )
  }
  return index
}

/** The area without its first row, which stays out as the header, unless `header` is `false`; a range of the header row alone is refused. */
function withoutHeader(area: ClosedArea, header: boolean | undefined): ClosedArea {
  if (header === false) return area
  const { startRowIndex, endRowIndex } = area.grid
  if (endRowIndex <= startRowIndex + 1) {
    throw new ToolError(
      "invalid_argument",
      `${areaLabel(area)} holds only its header row; give \`header: false\` to include it.`,
    )
  }
  return { ...area, grid: { ...area.grid, startRowIndex: startRowIndex + 1 } }
}

/** How a description says which row stays out as the header. */
function headerWords(area: ClosedArea, header: boolean | undefined): string {
  return header === false ? "" : `, row ${area.grid.startRowIndex + 1} stays as the header`
}

const sortSchema = z.strictObject({
  op: z.literal("sort"),
  range: rangeText.describe("The closed block to sort (`Plan!A1:D20`), whole rows of it moving together."),
  by: z
    .array(
      z.strictObject({
        column: columnLetterArg.describe("The column to sort by, which lies in the range."),
        order: z.enum(SORT_ORDERS).optional().describe(`\`${DEFAULT_SORT_ORDER}\` (the default) or \`desc\`.`),
      }),
    )
    .min(1)
    .max(MAX_SORT_KEYS)
    .describe(`1 to ${MAX_SORT_KEYS} keys, the first taking precedence.`),
  header: headerArg,
})

/** `sort`: sorts the rows of a closed block by columns of it, the header row staying where it is. */
export const sortOperation = defineOperation({
  schema: sortSchema,
  requests(op, { tabs }) {
    const area = onlyClosedArea(op, tabs, "sort")
    return [
      {
        sortRange: {
          range: withoutHeader(area, op.header).grid,
          sortSpecs: op.by.map(({ column, order }) => ({
            dimensionIndex: columnInside(column, area, "by"),
            sortOrder: SORT_ORDER_NAMES[order ?? DEFAULT_SORT_ORDER],
          })),
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [onlyClosedArea(op, tabs, "sort").tab],
  describe(op, { tabs }) {
    const area = onlyClosedArea(op, tabs, "sort")
    const keys = op.by.map(({ column, order }) => `${column.toUpperCase()} ${order ?? DEFAULT_SORT_ORDER}`)
    return `sort ${areaLabel(area)} by ${keys.join(", ")}${headerWords(area, op.header)}`
  },
  loses: (op, { tabs }) => [{ area: withoutHeader(onlyClosedArea(op, tabs, "sort"), op.header) }],
})

const dedupeSchema = z.strictObject({
  op: z.literal("dedupe"),
  range: rangeText.describe(
    "The closed block whose duplicate rows are deleted (`Plan!A1:D20`); the first of each stays.",
  ),
  compare: z
    .array(columnLetterArg)
    .min(1)
    .max(MAX_COMPARE_COLUMNS)
    .optional()
    .describe("The columns of the range whose values make two rows duplicates; left out, every column."),
  header: headerArg,
})

/** `dedupe`: deletes the rows of a closed block that repeat an earlier row, comparing all its columns or the ones named. */
export const dedupeOperation = defineOperation({
  schema: dedupeSchema,
  requests(op, { tabs }) {
    const area = onlyClosedArea(op, tabs, "dedupe")
    return [
      {
        deleteDuplicates: {
          range: withoutHeader(area, op.header).grid,
          comparisonColumns: (op.compare ?? []).map((column) => {
            const index = columnInside(column, area, "compare")
            return { sheetId: area.grid.sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 }
          }),
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [onlyClosedArea(op, tabs, "dedupe").tab],
  describe(op, { tabs }) {
    const area = onlyClosedArea(op, tabs, "dedupe")
    const columns = (op.compare ?? []).map((column) => column.toUpperCase())
    const by = columns.length === 0 ? "" : ` by ${columns.join(", ")}`
    return `dedupe ${areaLabel(area)}${by}, the first of each stays${headerWords(area, op.header)}`
  },
  loses: (op, { tabs }) => [{ area: withoutHeader(onlyClosedArea(op, tabs, "dedupe"), op.header) }],
})

const trimSchema = z
  .strictObject({ op: z.literal("trim"), ...rangeFields })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** `trim`: removes the spaces around the text of the cells of closed blocks, and the repeated ones inside it. */
export const trimOperation = defineOperation({
  schema: trimSchema,
  requests: (op, { tabs }) => closedAreasOf(op, tabs, "trim").map(({ grid }) => ({ trimWhitespace: { range: grid } })),
  tabs: (op, { tabs }) => tabsOfAreas(closedAreasOf(op, tabs, "trim")),
  describe: (op, { tabs }) => `trim ${rangesLabel(closedAreasOf(op, tabs, "trim"))}`,
  loses: (op, { tabs }) => closedAreasOf(op, tabs, "trim").map((area) => ({ area })),
})

const splitSchema = z.strictObject({
  op: z.literal("split_text"),
  range: rangeText.describe("The closed block of one column whose text is split (`Plan!A2:A50`)."),
  delimiter: z
    .string()
    .min(1)
    .refine((text) => namedDelimiter(text) !== undefined || Array.from(text).length === 1, {
      message: "The delimiter is `comma`, `semicolon`, `period`, `space`, `auto` or one character to split on.",
    })
    .optional()
    .describe(
      `What to split on: \`comma\`, \`semicolon\`, \`period\`, \`space\`, \`auto\` (the default: Google detects it) or one character.`,
    ),
})

/** The one column of the range a `split_text` splits, refusing a block of more. */
function splitSource(op: z.output<typeof splitSchema>, tabs: readonly SheetTab[]): ClosedArea {
  const area = onlyClosedArea(op, tabs, "split_text")
  if (sizeOf(area.grid).columns !== 1) {
    throw new ToolError(
      "invalid_argument",
      `split_text takes one column, such as \`Plan!A2:A50\`, not ${areaLabel(area)}.`,
    )
  }
  return area
}

/** `split_text`: splits the text of a column into the columns to its right, overwriting what is there. */
export const splitTextOperation = defineOperation({
  schema: splitSchema,
  needs: ["objects"],
  requests(op, { tabs }) {
    const text = op.delimiter ?? DEFAULT_DELIMITER
    const named = namedDelimiter(text)
    return [
      {
        textToColumns: {
          source: splitSource(op, tabs).grid,
          delimiterType: named ?? CUSTOM_DELIMITER,
          ...(named === undefined && { delimiter: text }),
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [splitSource(op, tabs).tab],
  describe(op, { tabs }) {
    const text = op.delimiter ?? DEFAULT_DELIMITER
    const named = namedDelimiter(text)
    const shown =
      named === undefined
        ? JSON.stringify(text)
        : named === DELIMITERS[DEFAULT_DELIMITER]
          ? "the detected separator"
          : named.toLowerCase()
    return `split_text ${areaLabel(splitSource(op, tabs))} on ${shown} into the columns to its right`
  },
  loses(op, { tabs, objects }) {
    const area = splitSource(op, tabs)
    const columns = objects.sizes.get(area.tab.sheetId)?.columns ?? 0
    return [{ area: { ...area, grid: { ...area.grid, endColumnIndex: Math.max(area.grid.endColumnIndex, columns) } } }]
  },
})

const autofillSchema = z.strictObject({
  op: z.literal("autofill"),
  range: rangeText.describe("The closed block to extend (`Plan!A1:A2`): its pattern continues into the fill."),
  fill: z.number().int().min(1).max(MAX_FILL).describe("How many rows or columns to extend it by."),
  direction: z
    .enum(FILL_DIRECTIONS)
    .optional()
    .describe(`\`${DEFAULT_FILL_DIRECTION}\` (the default), \`up\`, \`right\` or \`left\`.`),
})

/** The block an `autofill` fills: the `fill` rows or columns beyond the source on the side of the direction; one that would run past the first row or column is refused. */
function filledArea(op: z.output<typeof autofillSchema>, source: ClosedArea): ClosedArea {
  const {
    sheetId,
    startRowIndex: top,
    endRowIndex: bottom,
    startColumnIndex: left,
    endColumnIndex: right,
  } = source.grid
  const { rows, columns } = sizeOf(source.grid)
  const starts = {
    down: { row: bottom, column: left, size: { rows: op.fill, columns } },
    up: { row: top - op.fill, column: left, size: { rows: op.fill, columns } },
    right: { row: top, column: right, size: { rows, columns: op.fill } },
    left: { row: top, column: left - op.fill, size: { rows, columns: op.fill } },
  }[op.direction ?? DEFAULT_FILL_DIRECTION]
  if (starts.row < 0 || starts.column < 0) {
    throw new ToolError("invalid_argument", `The fill from ${areaLabel(source)} runs past the first row or column.`)
  }
  return { tab: source.tab, grid: blockAt(sheetId, starts.row, starts.column, starts.size) }
}

/** `autofill`: continues the pattern of a closed block into the rows or columns beyond it, overwriting them. */
export const autofillOperation = defineOperation({
  schema: autofillSchema,
  requests(op, { tabs }) {
    const source = onlyClosedArea(op, tabs, "autofill")
    const { dimension, sign } = FILL_AXES[op.direction ?? DEFAULT_FILL_DIRECTION]
    return [
      {
        autoFill: {
          useAlternateSeries: false,
          sourceAndDestination: { source: source.grid, dimension, fillLength: sign * op.fill },
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [onlyClosedArea(op, tabs, "autofill").tab],
  describe(op, { tabs }) {
    const source = onlyClosedArea(op, tabs, "autofill")
    return `autofill ${op.direction ?? DEFAULT_FILL_DIRECTION} from ${areaLabel(source)} into ${areaLabel(filledArea(op, source))}`
  },
  loses: (op, { tabs }) => [{ area: filledArea(op, onlyClosedArea(op, tabs, "autofill")) }],
})
