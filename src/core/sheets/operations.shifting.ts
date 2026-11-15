import { z } from "zod"
import { ToolError } from "../errors"
import { columnIndex, type DimensionRange } from "./grid"
import { defineOperation } from "./operations"
import {
  ONE_RANGE_MESSAGE,
  dimensionsOf,
  hasOneRange,
  rangeFields,
  rangeText,
  rangesLabel,
  tabsOfAreas,
  type ResolvedDimension,
} from "./operation-ranges"
import type { SheetTab } from "./tabs"

/** The most characters a `move` destination may have: a row number or a column's letters. */
const MAX_DESTINATION_LENGTH = 10

/** A row number: whole, from 1. */
const ROW_NUMBER_PATTERN = /^[1-9][0-9]{0,8}$/

/** A column's letters, as A1 notation allows them. */
const COLUMN_LETTERS_PATTERN = /^[A-Za-z]{1,3}$/

const INHERIT_SIDES = ["before", "after"] as const

/** The word for one row or one column of the dimension. */
function unitOf({ dimension }: DimensionRange): string {
  return dimension === "ROWS" ? "row" : "column"
}

/** The one range of an operation that takes a single range, as whole rows or whole columns. */
function onlyDimension(op: { range: string }, tabs: readonly SheetTab[]): ResolvedDimension {
  return dimensionsOf(op, tabs)[0]!
}

const insertSchema = z.strictObject({
  op: z.literal("insert"),
  range: rangeText.describe(
    "Whole rows (`Plan!5:7`) or whole columns (`Plan!C:D`): as many new ones as the range spans go in before them, and the ones named shift down or right.",
  ),
  inherit: z
    .enum(INHERIT_SIDES)
    .optional()
    .describe(
      "Whose formatting the new rows or columns take: the ones `before` them (the default; the first row or column has none) or `after` them.",
    ),
})

/** `insert`: inserts empty rows or columns before the ones the range names. */
export const insertOperation = defineOperation({
  schema: insertSchema,
  requests(op, { tabs }) {
    const { dimension } = onlyDimension(op, tabs)
    const inheritFromBefore = (op.inherit ?? "before") === "before"
    if (inheritFromBefore && dimension.startIndex === 0) {
      throw new ToolError(
        "invalid_argument",
        `${JSON.stringify(op.range)} starts at the first ${unitOf(dimension)}, which has no ${unitOf(dimension)} before it to inherit from; give \`inherit: "after"\`.`,
      )
    }
    return [{ insertDimension: { range: dimension, inheritFromBefore } }]
  },
  tabs: (op, { tabs }) => tabsOfAreas([onlyDimension(op, tabs)]),
  describe(op, { tabs }) {
    const area = onlyDimension(op, tabs)
    const count = area.dimension.endIndex - area.dimension.startIndex
    const unit = unitOf(area.dimension)
    return `insert ${count} ${unit}${count === 1 ? "" : "s"} before ${rangesLabel([area])}, formatted like the ${unit} ${op.inherit ?? "before"}`
  },
})

const deleteSchema = z.strictObject({ op: z.literal("delete"), ...rangeFields }).refine(hasOneRange, {
  message: ONE_RANGE_MESSAGE,
})

/**
 * The ranges of a `delete` as whole rows or whole columns, from the bottom
 * (the right) up, so that deleting one leaves the position of the next
 * alone. Two ranges of one tab that overlap are `invalid_argument`.
 */
function deletions(op: z.output<typeof deleteSchema>, tabs: readonly SheetTab[]): ResolvedDimension[] {
  const bottomUp = [...dimensionsOf(op, tabs)].sort((a, b) => b.dimension.startIndex - a.dimension.startIndex)
  const above = new Map<string, ResolvedDimension>()
  for (const area of bottomUp) {
    const key = `${area.dimension.sheetId}:${area.dimension.dimension}`
    const higher = above.get(key)
    if (higher !== undefined && area.dimension.endIndex > higher.dimension.startIndex) {
      throw new ToolError(
        "invalid_argument",
        `The ranges ${JSON.stringify(rangesLabel([area]))} and ${JSON.stringify(rangesLabel([higher]))} overlap.`,
      )
    }
    above.set(key, area)
  }
  return bottomUp
}

/** `delete`: deletes whole rows or whole columns with their contents; several ranges go from the bottom (the right) up. */
export const deleteOperation = defineOperation({
  schema: deleteSchema,
  shifts: true,
  requests: (op, { tabs }) => deletions(op, tabs).map(({ dimension }) => ({ deleteDimension: { range: dimension } })),
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe: (op, { tabs }) => `delete ${rangesLabel(dimensionsOf(op, tabs))}`,
  loses: (op, { tabs }) => dimensionsOf(op, tabs).map((area) => ({ area })),
})

const moveSchema = z.strictObject({
  op: z.literal("move"),
  range: rangeText.describe("Whole rows (`Plan!5:7`) or whole columns (`Plan!C:D`) to move."),
  to: z
    .union([z.string().min(1).max(MAX_DESTINATION_LENGTH), z.number().int().min(1)])
    .describe(
      "Where they go: the row number (rows) or the column letter (columns) they move in front of, counted as the sheet stands before the move.",
    ),
})

/** Where a `move` puts the rows or columns: the zero-based index Google takes, and how the line names it. */
function destinationOf(to: string | number, { dimension }: DimensionRange): { index: number; label: string } {
  const text = String(to).trim()
  if (dimension === "ROWS" && ROW_NUMBER_PATTERN.test(text)) return { index: Number(text) - 1, label: `row ${text}` }
  if (dimension === "COLUMNS" && typeof to === "string" && COLUMN_LETTERS_PATTERN.test(text)) {
    return { index: columnIndex(text), label: `column ${text.toUpperCase()}` }
  }
  throw new ToolError(
    "invalid_argument",
    `\`to\` is the ${dimension === "ROWS" ? "row number" : "column letter"} to move the ${dimension === "ROWS" ? "rows" : "columns"} in front of, not ${JSON.stringify(to)}.`,
  )
}

/** `move`: moves whole rows or whole columns in front of another row or column. */
export const moveOperation = defineOperation({
  schema: moveSchema,
  shifts: true,
  requests(op, { tabs }) {
    const { dimension } = onlyDimension(op, tabs)
    return [{ moveDimension: { source: dimension, destinationIndex: destinationOf(op.to, dimension).index } }]
  },
  tabs: (op, { tabs }) => tabsOfAreas([onlyDimension(op, tabs)]),
  describe(op, { tabs }) {
    const area = onlyDimension(op, tabs)
    return `move ${rangesLabel([area])} before ${destinationOf(op.to, area.dimension).label}`
  },
})
