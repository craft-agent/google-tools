import { z } from "zod"
import { ToolError } from "../errors"
import type { GridBounds } from "./a1"
import { CONDITION_TYPES, conditionOf, conditionWords, fewValues, listValues, plainValues } from "./conditions"
import { columnIndex } from "./grid"
import { columnLetterArg } from "./operation-ranges"

/** The most columns one filter sets criteria on. */
const MAX_FILTER_COLUMNS = 100

const filterColumnSchema = z
  .strictObject({
    column: columnLetterArg.describe("The column's letter; it lies in the filter's range."),
    hide: listValues.optional().describe("The values to hide in the column."),
    when: z
      .enum(CONDITION_TYPES)
      .optional()
      .describe("A condition the column's values must meet to show: Google's condition type, such as `TEXT_CONTAINS`."),
    values: listValues.optional().describe("The condition's values, with `when`."),
  })
  .refine((column) => column.when !== undefined || column.values === undefined, {
    message: "A filter column's `values` need `when`.",
  })
  .refine((column) => column.hide !== undefined || column.when !== undefined, {
    message: "A filter column needs `hide` or `when`.",
  })

/** The criteria a filter or a filter view sets, by column: values to hide, a condition to meet, or both. */
export const filterColumnsArg = z.array(filterColumnSchema).max(MAX_FILTER_COLUMNS)

export type FilterColumns = z.output<typeof filterColumnsArg>

/**
 * Google's `filterSpecs` for the columns of a filter over `range`: each
 * criterion's column counted from the left of the tab. A column outside the
 * range is `invalid_argument`.
 */
export function filterSpecs(columns: FilterColumns | undefined, range: GridBounds): Record<string, unknown>[] {
  const start = range.startColumnIndex ?? 0
  const end = range.endColumnIndex
  return (columns ?? []).map((column) => {
    const index = columnIndex(column.column)
    if (index < start || (end !== undefined && index >= end)) {
      throw new ToolError(
        "invalid_argument",
        `Filter column ${column.column.toUpperCase()} is outside the filter's range.`,
      )
    }
    return {
      columnIndex: index,
      filterCriteria: {
        ...(column.hide !== undefined && { hiddenValues: plainValues(column.hide) }),
        ...(column.when !== undefined && { condition: conditionOf(column.when, plainValues(column.values), true) }),
      },
    }
  })
}

/** The criteria as a description shows them: `C hide (a, b), show TEXT_CONTAINS x; D …`. */
export function filterWords(columns: FilterColumns | undefined): string {
  return (columns ?? [])
    .map((column) => {
      const words = [
        ...(column.hide === undefined ? [] : [`hide (${fewValues(plainValues(column.hide))})`]),
        ...(column.when === undefined ? [] : [`show ${conditionWords(column.when, plainValues(column.values))}`]),
      ]
      return `${column.column.toUpperCase()} ${words.join(", ")}`
    })
    .join("; ")
}
