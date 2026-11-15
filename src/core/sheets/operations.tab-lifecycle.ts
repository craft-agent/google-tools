import { z } from "zod"
import { ToolError } from "../errors"
import { quoteTab } from "./a1"
import { defineOperation, type OperationContext } from "./operations"
import { tabNamed, tabTitle } from "./operations.tabs"
import { MAX_TAB_TITLE_LENGTH } from "./schemas"
import type { SheetTab } from "./tabs"

/** What stands in `order` for a tab an operation creates, which has no id until Google answers. */
const PENDING_TAB = -1

const newTabTitle = z.string().min(1).max(MAX_TAB_TITLE_LENGTH)

/** Refuses a title that another tab of the spreadsheet has, or that an earlier operation of the call gives a tab, ignoring case; `own` is the tab being renamed, which may change the case of its own title. */
function requireFreeTitle(context: OperationContext, title: string, own?: SheetTab): void {
  const taken = [
    ...context.tabs.filter((tab) => tab.sheetId !== own?.sheetId).map((tab) => tab.title),
    ...context.created,
  ].find((used) => used.toLowerCase() === title.toLowerCase())
  if (taken !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `The spreadsheet already has a tab titled ${JSON.stringify(taken)}; a tab's title must be new, ignoring case.`,
    )
  }
}

const duplicateSchema = z.strictObject({
  op: z.literal("tab_duplicate"),
  tab: tabTitle.describe("The title of the tab to copy."),
  title: newTabTitle
    .optional()
    .describe("The copy's title; no tab may have it already, ignoring case. Left out, Google names it."),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Where the copy goes, counted from 0 on the left. Left out, right after the original."),
})

/** `tab_duplicate`: copies a tab, with its contents and formatting, as a new tab. */
export const tabDuplicateOperation = defineOperation({
  schema: duplicateSchema,
  onSpreadsheet: true,
  requests(op, context) {
    const source = tabNamed(context.tabs, op.tab)
    if (op.title !== undefined) {
      requireFreeTitle(context, op.title)
      context.created.push(op.title)
    }
    const position =
      op.position === undefined
        ? context.order.indexOf(source.sheetId) + 1
        : Math.min(op.position, context.order.length)
    context.order.splice(position, 0, PENDING_TAB)
    return [
      {
        duplicateSheet: {
          sourceSheetId: source.sheetId,
          insertSheetIndex: position,
          ...(op.title !== undefined && { newSheetName: op.title }),
        },
      },
    ]
  },
  tabs: () => [],
  describe(op, { tabs }) {
    const title = op.title === undefined ? "" : ` as ${JSON.stringify(op.title)}`
    const position = op.position === undefined ? "next to it" : `at position ${op.position}`
    return `tab_duplicate ${quoteTab(tabNamed(tabs, op.tab).title)}${title} ${position}`
  },
})

const deleteTabSchema = z.strictObject({
  op: z.literal("tab_delete"),
  tab: tabTitle.describe("The title of the tab to delete."),
})

/** `tab_delete`: deletes a tab with all its contents; a spreadsheet keeps at least one visible tab. */
export const tabDeleteOperation = defineOperation({
  schema: deleteTabSchema,
  requests(op, context) {
    const tab = tabNamed(context.tabs, op.tab)
    if (!tab.hidden && context.tabs.filter((other) => !other.hidden).length === 1) {
      throw new ToolError(
        "invalid_argument",
        `${JSON.stringify(tab.title)} is the only visible tab, and a spreadsheet keeps at least one visible tab; show another tab first.`,
      )
    }
    context.tabs = context.tabs.filter((other) => other.sheetId !== tab.sheetId)
    context.order.splice(context.order.indexOf(tab.sheetId), 1)
    return [{ deleteSheet: { sheetId: tab.sheetId } }]
  },
  tabs: (op, { tabs }) => [tabNamed(tabs, op.tab)],
  describe: (op, { tabs }) => `tab_delete ${quoteTab(tabNamed(tabs, op.tab).title)} with all its contents`,
  loses(op, { tabs }) {
    const tab = tabNamed(tabs, op.tab)
    return [{ area: { tab, grid: { sheetId: tab.sheetId } } }]
  },
  retitles: (op, { tabs }) => [tabNamed(tabs, op.tab)],
})

const renameTabSchema = z.strictObject({
  op: z.literal("tab_rename"),
  tab: tabTitle.describe("The title of the tab to rename."),
  title: newTabTitle.describe("The new title; no other tab may have it, ignoring case."),
})

/** `tab_rename`: gives a tab a new title. */
export const tabRenameOperation = defineOperation({
  schema: renameTabSchema,
  requests(op, context) {
    const tab = tabNamed(context.tabs, op.tab)
    requireFreeTitle(context, op.title, tab)
    context.tabs = context.tabs.map((other) => (other.sheetId === tab.sheetId ? { ...other, title: op.title } : other))
    return [{ updateSheetProperties: { properties: { sheetId: tab.sheetId, title: op.title }, fields: "title" } }]
  },
  tabs: (op, { tabs }) => [tabNamed(tabs, op.tab)],
  describe: (op, { tabs }) => `tab_rename ${quoteTab(tabNamed(tabs, op.tab).title)} to ${JSON.stringify(op.title)}`,
  retitles: (op, { tabs }) => [tabNamed(tabs, op.tab)],
})
