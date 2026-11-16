import { z } from "zod"
import { ToolError } from "../errors"
import type { DimensionRange } from "./grid"
import { defineOperation, type OperationContext, type SheetsRequest } from "./operations"
import {
  ONE_RANGE_MESSAGE,
  dimensionsOf,
  hasOneRange,
  rangeFields,
  rangesLabel,
  tabsOfAreas,
  type RangedOperation,
} from "./operation-ranges"

const MAX_PIXELS = 10_000

const sizeSchema = z
  .strictObject({
    op: z.literal("size"),
    ...rangeFields,
    pixels: z
      .number()
      .int()
      .min(1)
      .max(MAX_PIXELS)
      .optional()
      .describe(`The height of the rows or the width of the columns in pixels (1 to ${MAX_PIXELS}).`),
    auto: z.boolean().optional().describe("`true` fits the rows or columns to their contents, in place of `pixels`."),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
  .refine((op) => (op.pixels !== undefined) !== (op.auto === true), {
    message: "Give `pixels` or `auto: true`, one of them.",
  })

/** `size`: sets the height of whole rows or the width of whole columns, or fits them to their contents. */
export const sizeOperation = defineOperation({
  schema: sizeSchema,
  requests: (op, { tabs }) =>
    dimensionsOf(op, tabs).map(({ dimension }) =>
      op.pixels === undefined
        ? { autoResizeDimensions: { dimensions: dimension } }
        : {
            updateDimensionProperties: {
              range: dimension,
              properties: { pixelSize: op.pixels },
              fields: "pixelSize",
            },
          },
    ),
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe: (op, { tabs }) =>
    `size ${rangesLabel(dimensionsOf(op, tabs))} ${op.pixels === undefined ? "auto" : `${op.pixels}px`}`,
})

/** The request that shows or hides the dimension of each range. */
function hiddenRequests(op: RangedOperation, { tabs }: OperationContext, hidden: boolean): SheetsRequest[] {
  return dimensionsOf(op, tabs).map(({ dimension }) => ({
    updateDimensionProperties: { range: dimension, properties: { hiddenByUser: hidden }, fields: "hiddenByUser" },
  }))
}

const hideSchema = z.strictObject({ op: z.literal("hide"), ...rangeFields }).refine(hasOneRange, {
  message: ONE_RANGE_MESSAGE,
})

/** `hide`: hides whole rows or whole columns. */
export const hideOperation = defineOperation({
  schema: hideSchema,
  requests: (op, context) => hiddenRequests(op, context, true),
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe: (op, { tabs }) => `hide ${rangesLabel(dimensionsOf(op, tabs))}`,
})

const unhideSchema = z.strictObject({ op: z.literal("unhide"), ...rangeFields }).refine(hasOneRange, {
  message: ONE_RANGE_MESSAGE,
})

/** `unhide`: shows whole rows or whole columns again. */
export const unhideOperation = defineOperation({
  schema: unhideSchema,
  requests: (op, context) => hiddenRequests(op, context, false),
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe: (op, { tabs }) => `unhide ${rangesLabel(dimensionsOf(op, tabs))}`,
})

const groupSchema = z
  .strictObject({
    op: z.literal("group"),
    ...rangeFields,
    collapsed: z
      .boolean()
      .optional()
      .describe("`true` collapses the group, an existing one included; default expanded."),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** Whether two dimension ranges are the same span: the same tab, dimension, start and end. */
function sameSpan(a: DimensionRange, b: DimensionRange): boolean {
  return (
    a.sheetId === b.sheetId && a.dimension === b.dimension && a.startIndex === b.startIndex && a.endIndex === b.endIndex
  )
}

/** Whether the group `outer` holds the whole of `inner`, `outer` being `inner` itself included. */
function holds(outer: DimensionRange, inner: DimensionRange): boolean {
  return (
    outer.sheetId === inner.sheetId &&
    outer.dimension === inner.dimension &&
    outer.startIndex <= inner.startIndex &&
    outer.endIndex >= inner.endIndex
  )
}

/**
 * Plans the ranges of a `group` against `groups`, the groups as they stand,
 * and adds each range that is not a group yet to them, so a later range of
 * the call sees it. A span that already is a group is not grouped again: it
 * keeps the depth it has; a new one goes one level inside every group that
 * holds it.
 */
function planGroups(op: z.output<typeof groupSchema>, tabs: OperationContext["tabs"], groups: DimensionRange[]) {
  return dimensionsOf(op, tabs).map(({ dimension }) => {
    const existing = groups.some((group) => sameSpan(group, dimension))
    const depth = groups.filter((group) => holds(group, dimension)).length + (existing ? 0 : 1)
    if (!existing) groups.push(dimension)
    return { dimension, existing, depth }
  })
}

/**
 * `group`: groups whole rows or whole columns, one level inside every group
 * that already holds them. A span that already is a group is left as it is,
 * so grouping twice is grouping once; `collapsed` still collapses it.
 */
export const groupOperation = defineOperation({
  schema: groupSchema,
  needs: ["groups"],
  requests(op, context) {
    return planGroups(op, context.tabs, context.groups).flatMap(({ dimension, existing, depth }) => [
      ...(existing ? [] : [{ addDimensionGroup: { range: dimension } }]),
      ...(op.collapsed === true
        ? [
            {
              updateDimensionGroup: {
                dimensionGroup: { range: dimension, depth, collapsed: true },
                fields: "collapsed",
              },
            },
          ]
        : []),
    ])
  },
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe(op, { tabs, groups }) {
    const planned = planGroups(op, tabs, [...groups])
    const already = planned.filter(({ existing }) => existing).length
    const note =
      already === 0 ? "" : already === planned.length ? " (already grouped)" : ` (${already} already grouped)`
    return `group ${rangesLabel(dimensionsOf(op, tabs))}${op.collapsed === true ? " collapsed" : ""}${note}`
  },
})

const ungroupSchema = z.strictObject({ op: z.literal("ungroup"), ...rangeFields }).refine(hasOneRange, {
  message: ONE_RANGE_MESSAGE,
})

/** `ungroup`: removes the innermost group over exactly these rows or columns; a span that is not a group is `invalid_argument`. */
export const ungroupOperation = defineOperation({
  schema: ungroupSchema,
  needs: ["groups"],
  requests(op, context) {
    return dimensionsOf(op, context.tabs).map((area) => {
      const found = context.groups.map((group) => sameSpan(group, area.dimension)).lastIndexOf(true)
      if (found < 0) {
        throw new ToolError(
          "invalid_argument",
          `${JSON.stringify(rangesLabel([area]))} is not a group, so it cannot be ungrouped.`,
        )
      }
      context.groups.splice(found, 1)
      return { deleteDimensionGroup: { range: area.dimension } }
    })
  },
  tabs: (op, { tabs }) => tabsOfAreas(dimensionsOf(op, tabs)),
  describe: (op, { tabs }) => `ungroup ${rangesLabel(dimensionsOf(op, tabs))}`,
})
