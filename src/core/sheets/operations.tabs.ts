import { z } from "zod"
import { quoteTab } from "./a1"
import { colorArg, normalizedColor, toColorStyle } from "./colors"
import { defineOperation } from "./operations"
import { MAX_RANGE_LENGTH } from "./schemas"
import { tabOfRange, type SheetTab } from "./tabs"

const MAX_FROZEN = 10_000

/** The cells of a range that has no tab, so `tabOfRange` gives the first tab. */
const ANY_CELL = "A1"

const tabTitle = z.string().min(1).max(MAX_RANGE_LENGTH)

/** The tab the title names (exactly, else ignoring case when that leaves one), the first tab for no title; `invalid_argument` for one the spreadsheet lacks. */
function tabNamed(tabs: readonly SheetTab[], title: string | undefined): SheetTab {
  return tabOfRange(tabs, title === undefined ? ANY_CELL : quoteTab(title))
}

const freezeSchema = z
  .strictObject({
    op: z.literal("freeze"),
    tab: tabTitle.optional().describe("The tab's title; left out, the first tab."),
    rows: z.number().int().min(0).max(MAX_FROZEN).optional().describe("How many rows stay in view; 0 unfreezes them."),
    columns: z
      .number()
      .int()
      .min(0)
      .max(MAX_FROZEN)
      .optional()
      .describe("How many columns stay in view; 0 unfreezes them."),
  })
  .refine((op) => op.rows !== undefined || op.columns !== undefined, {
    message: "Give `rows` or `columns`, or both (0 unfreezes).",
  })

/** `freeze`: sets how many rows and columns of a tab stay in view. */
export const freezeOperation = defineOperation({
  schema: freezeSchema,
  requests(op, { tabs }) {
    const counts = {
      ...(op.rows !== undefined && { frozenRowCount: op.rows }),
      ...(op.columns !== undefined && { frozenColumnCount: op.columns }),
    }
    return [
      {
        updateSheetProperties: {
          properties: { sheetId: tabNamed(tabs, op.tab).sheetId, gridProperties: counts },
          fields: Object.keys(counts)
            .map((count) => `gridProperties.${count}`)
            .join(","),
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [tabNamed(tabs, op.tab)],
  describe(op, { tabs }) {
    const counts = [
      ...(op.rows === undefined ? [] : [`rows ${op.rows}`]),
      ...(op.columns === undefined ? [] : [`columns ${op.columns}`]),
    ]
    return `freeze ${quoteTab(tabNamed(tabs, op.tab).title)} ${counts.join(", ")}`
  },
})

const tabSchema = z
  .strictObject({
    op: z.literal("tab"),
    tab: tabTitle.describe("The tab's title."),
    color: colorArg.nullable().optional().describe("The tab's color, `#rrggbb`; `null` clears it."),
    hidden: z.boolean().optional().describe("`true` hides the tab, `false` shows it."),
    position: z.number().int().min(0).optional().describe("Where the tab ends up, counted from 0 on the left."),
    gridlines: z.boolean().optional().describe("Whether the tab shows its gridlines."),
  })
  .refine((op) => [op.color, op.hidden, op.position, op.gridlines].some((value) => value !== undefined), {
    message: "Give `color`, `hidden`, `position` or `gridlines`; this operation never renames a tab.",
  })

/** `tab`: sets a tab's color, visibility, position or gridlines; never its title. */
export const tabOperation = defineOperation({
  schema: tabSchema,
  requests(op, context) {
    const { sheetId } = tabNamed(context.tabs, op.tab)
    const properties: Record<string, unknown> = { sheetId }
    const fields: string[] = []
    if (op.color !== undefined) {
      if (op.color !== null) properties.tabColorStyle = toColorStyle(op.color)
      fields.push("tabColor", "tabColorStyle")
    }
    if (op.hidden !== undefined) {
      properties.hidden = op.hidden
      fields.push("hidden")
    }
    if (op.gridlines !== undefined) {
      properties.gridProperties = { hideGridlines: !op.gridlines }
      fields.push("gridProperties.hideGridlines")
    }
    if (op.position !== undefined) {
      // Google counts the tab's new index as the tabs stand before it moves, so a move to the right counts one more.
      const current = context.order.indexOf(sheetId)
      const final = Math.min(op.position, context.order.length - 1)
      properties.index = final > current ? final + 1 : final
      context.order.splice(current, 1)
      context.order.splice(final, 0, sheetId)
      fields.push("index")
    }
    return [{ updateSheetProperties: { properties, fields: fields.join(",") } }]
  },
  tabs: (op, { tabs }) => [tabNamed(tabs, op.tab)],
  describe(op, { tabs }) {
    const words = [
      ...(op.color === undefined ? [] : [op.color === null ? "no color" : `color ${normalizedColor(op.color)}`]),
      ...(op.hidden === undefined ? [] : [op.hidden ? "hidden" : "visible"]),
      ...(op.position === undefined ? [] : [`position ${op.position}`]),
      ...(op.gridlines === undefined ? [] : [op.gridlines ? "gridlines" : "no gridlines"]),
    ]
    return `tab ${quoteTab(tabNamed(tabs, op.tab).title)} ${words.join(", ")}`
  },
})
