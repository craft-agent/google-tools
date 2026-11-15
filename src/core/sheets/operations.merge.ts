import { z } from "zod"
import type { Keeps } from "./before"
import { defineOperation } from "./operations"
import { ONE_RANGE_MESSAGE, areasOf, hasOneRange, rangeFields, rangesLabel, tabsOfAreas } from "./operation-ranges"

const MERGE_MODES = ["all", "columns", "rows"] as const

type MergeMode = (typeof MERGE_MODES)[number]

const DEFAULT_MERGE_MODE: MergeMode = "all"

/** Google's name for each way of merging. */
const MERGE_TYPES = { all: "MERGE_ALL", columns: "MERGE_COLUMNS", rows: "MERGE_ROWS" } as const satisfies Record<
  MergeMode,
  string
>

/** The cell each block of a merge keeps: the top-left one of the range, of each column, or of each row. */
const KEPT_CELLS = {
  all: (row, column) => row === 0 && column === 0,
  columns: (row) => row === 0,
  rows: (_row, column) => column === 0,
} as const satisfies Record<MergeMode, Keeps>

const mergeSchema = z
  .strictObject({
    op: z.literal("merge"),
    ...rangeFields,
    merge: z
      .enum(MERGE_MODES)
      .optional()
      .describe(
        "`all` merges each range into one block (the default), `columns` merges each column of it, `rows` each row. Only the top-left value of each merged block stays.",
      ),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** `merge`: merges the cells of the ranges, which keeps only each block's top-left value. */
export const mergeOperation = defineOperation({
  schema: mergeSchema,
  requests: (op, { tabs }) =>
    areasOf(op, tabs).map(({ grid }) => ({
      mergeCells: { range: grid, mergeType: MERGE_TYPES[op.merge ?? DEFAULT_MERGE_MODE] },
    })),
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, { tabs }) {
    const mode = op.merge ?? DEFAULT_MERGE_MODE
    return `merge ${rangesLabel(areasOf(op, tabs))}${mode === DEFAULT_MERGE_MODE ? "" : ` by ${mode}`}`
  },
  loses: (op, { tabs }) =>
    areasOf(op, tabs).map((area) => ({ area, keeps: KEPT_CELLS[op.merge ?? DEFAULT_MERGE_MODE] })),
})
