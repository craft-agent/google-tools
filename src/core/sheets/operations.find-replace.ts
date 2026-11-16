import { z } from "zod"
import { cut } from "../describe"
import { quoteTab } from "./a1"
import { resolveRange, type ResolvedRange } from "./grid"
import { defineOperation } from "./operations"
import { areaLabel, rangeText, tabsOfAreas } from "./operation-ranges"
import { tabNamed, tabTitle } from "./operations.tabs"
import { MAX_CELL_TEXT_LENGTH } from "./schemas"
import type { SheetTab } from "./tabs"

/** The most characters of a text to look for. */
const MAX_FIND_LENGTH = 1_000

/** How many characters of the text to look for or of its replacement a line shows. */
const SHOWN_TEXT_LENGTH = 40

const findReplaceSchema = z
  .strictObject({
    op: z.literal("find_replace"),
    find: z.string().min(1).max(MAX_FIND_LENGTH).describe("The text to look for."),
    replacement: z
      .string()
      .max(MAX_CELL_TEXT_LENGTH)
      .optional()
      .describe("What replaces it; the default, an empty text, removes the matches."),
    range: rangeText.optional().describe("Look in this A1 range (`Plan!A1:C20`, or `Plan!B:B`)."),
    tab: tabTitle.optional().describe("Look in the whole of the tab with this title."),
    all_tabs: z.literal(true).optional().describe("`true` looks in every tab."),
    match_case: z.boolean().optional().describe("Match upper and lower case exactly; default `false`."),
    whole_cell: z.boolean().optional().describe("Match only a cell whose whole text is `find`; default `false`."),
    regex: z.boolean().optional().describe("Read `find` as a regular expression; default `false`."),
    formulas: z.boolean().optional().describe("Look in formulas too, not only in values; default `false`."),
  })
  .refine((op) => [op.range, op.tab, op.all_tabs].filter((scope) => scope !== undefined).length === 1, {
    message: "Give exactly one of `range`, `tab` or `all_tabs: true`.",
  })

type FindReplaceOperation = z.output<typeof findReplaceSchema>

/** The ways a call of this operation narrows its matching, each as the word a line shows it by. */
const FLAGS = [
  ["match_case", "match case"],
  ["whole_cell", "whole cell"],
  ["regex", "regex"],
  ["formulas", "formulas too"],
] as const

/** The cells the operation looks in: its range, the whole of its tab, or the whole of every tab. */
function scopeOf(op: FindReplaceOperation, tabs: readonly SheetTab[]): ResolvedRange[] {
  if (op.range !== undefined) return [resolveRange(tabs, op.range)]
  if (op.tab !== undefined) {
    const tab = tabNamed(tabs, op.tab)
    return [{ tab, grid: { sheetId: tab.sheetId } }]
  }
  return tabs.map((tab) => ({ tab, grid: { sheetId: tab.sheetId } }))
}

/** What Google is asked to look in: the range, the tab's id, or every tab. */
function scopeRequest(op: FindReplaceOperation, [first]: ResolvedRange[]): Record<string, unknown> {
  if (op.range !== undefined) return { range: first!.grid }
  if (op.tab !== undefined) return { sheetId: first!.tab.sheetId }
  return { allSheets: true }
}

/** Where a line says the operation looks. */
function scopeWords(op: FindReplaceOperation, scope: ResolvedRange[]): string {
  if (op.range !== undefined) return areaLabel(scope[0]!)
  if (op.tab !== undefined) return `${quoteTab(scope[0]!.tab.title)} (whole tab)`
  return "every tab"
}

/** `find_replace`: replaces the text found in a range, a tab or every tab, which rewrites the cells that hold it. */
export const findReplaceOperation = defineOperation({
  schema: findReplaceSchema,
  requests: (op, { tabs }) => [
    {
      findReplace: {
        find: op.find,
        replacement: op.replacement ?? "",
        matchCase: op.match_case ?? false,
        matchEntireCell: op.whole_cell ?? false,
        searchByRegex: op.regex ?? false,
        includeFormulas: op.formulas ?? false,
        ...scopeRequest(op, scopeOf(op, tabs)),
      },
    },
  ],
  tabs: (op, { tabs }) => tabsOfAreas(scopeOf(op, tabs)),
  describe(op, { tabs }) {
    const flags = FLAGS.filter(([flag]) => op[flag] === true).map(([, words]) => words)
    const replacement = op.replacement ?? ""
    const shown = (text: string) => JSON.stringify(cut(text, SHOWN_TEXT_LENGTH))
    return (
      `find_replace ${shown(op.find)} with ${replacement === "" ? "nothing" : shown(replacement)} in ${scopeWords(op, scopeOf(op, tabs))}` +
      (flags.length === 0 ? "" : ` (${flags.join(", ")})`)
    )
  },
  loses: (op, { tabs }) => scopeOf(op, tabs).map((area) => ({ area })),
})
