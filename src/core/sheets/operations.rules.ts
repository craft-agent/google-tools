import { z } from "zod"
import { ToolError } from "../errors"
import { quoteTab } from "./a1"
import { colorArg, normalizedColor, toColorStyle } from "./colors"
import { CONDITION_TYPES, conditionOf, conditionText, conditionWords, listValues, plainValues } from "./conditions"
import { resolveRange, type ResolvedRange } from "./grid"
import { COLOR_SCALE, type RuleState } from "./objects"
import { defineOperation, type OperationContext } from "./operations"
import {
  ONE_RANGE_MESSAGE,
  hasOneRange,
  rangeFields,
  rangesLabel,
  rangesOf,
  resolveOn,
  tabsOfAreas,
} from "./operation-ranges"
import { tabNamed, tabTitle } from "./operations.tabs"
import type { SheetTab } from "./tabs"

/** The highest rule number an operation names. */
const MAX_RULE_INDEX = 10_000

const MIN_SCALE_COLORS = 2
const MAX_SCALE_COLORS = 3

/** Where a scale's middle color sits: the median of the values. */
const MIDDLE_PERCENTILE = "50"

const STYLE_FLAGS = ["bold", "italic", "strikethrough"] as const

const indexArg = z.number().int().min(0).max(MAX_RULE_INDEX)

/** The arguments of a rule: the ranges it colors, and either a condition with a style or a color scale. */
const ruleFields = {
  ...rangeFields,
  when: z
    .enum(CONDITION_TYPES)
    .optional()
    .describe("The condition a cell meets to be styled: Google's condition type, such as `NUMBER_GREATER`."),
  values: listValues.optional().describe("The condition's values; a formula needs no leading `=`."),
  scale: z
    .array(colorArg)
    .min(MIN_SCALE_COLORS)
    .max(MAX_SCALE_COLORS)
    .optional()
    .describe("Two or three colors, the lowest value's first, for a color scale in place of `when` and a style."),
  bold: z.boolean().optional().describe("Bold text."),
  italic: z.boolean().optional().describe("Italic text."),
  strikethrough: z.boolean().optional().describe("Struck-through text."),
  color: colorArg.optional().describe("The text color, `#rrggbb`."),
  background: colorArg.optional().describe("The background color, `#rrggbb`."),
}

type RuleFields = z.output<z.ZodObject<typeof ruleFields>>

/** The format a rule applies, and how its parts read in a description. */
function styleOf(op: RuleFields): { format: Record<string, unknown>; words: string[] } {
  const text: Record<string, unknown> = {}
  const words: string[] = []
  for (const flag of STYLE_FLAGS) {
    if (op[flag] === undefined) continue
    text[flag] = op[flag]
    words.push(op[flag] ? flag : `no ${flag}`)
  }
  if (op.color !== undefined) {
    text.foregroundColorStyle = toColorStyle(op.color)
    words.push(`color ${normalizedColor(op.color)}`)
  }
  const format: Record<string, unknown> = {}
  if (Object.keys(text).length > 0) format.textFormat = text
  if (op.background !== undefined) {
    format.backgroundColorStyle = toColorStyle(op.background)
    words.push(`background ${normalizedColor(op.background)}`)
  }
  return { format, words }
}

/** Whether the rule has a condition with a style, or a scale, and not parts of both. */
function isRule(op: RuleFields): boolean {
  const styled = styleOf(op).words.length > 0
  return op.scale === undefined
    ? op.when !== undefined && styled
    : op.when === undefined && op.values === undefined && !styled
}

const RULE_MESSAGE =
  "Give `when` with at least one style (`bold`, `italic`, `strikethrough`, `color`, `background`), or a `scale` alone."

const ruleSchema = z
  .strictObject({ op: z.literal("conditional"), ...ruleFields })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
  .refine(isRule, { message: RULE_MESSAGE })

const ruleUpdateSchema = z
  .strictObject({
    op: z.literal("conditional_update"),
    tab: tabTitle
      .optional()
      .describe("The tab whose rule it is; a range with no tab stays on it. Left out, the tab of the ranges."),
    index: indexArg.describe("The rule's number among the tab's rules, from 0, as `structure` lists them."),
    ...ruleFields,
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
  .refine(isRule, { message: RULE_MESSAGE })

const ruleDeleteSchema = z.strictObject({
  op: z.literal("conditional_delete"),
  tab: tabTitle.optional().describe("The tab's title; left out, the first tab."),
  index: indexArg.describe("The rule's number among the tab's rules, from 0, as `structure` lists them."),
})

/** The ranges of a rule, and the one tab they lie on, which is `own` when the operation names one. */
function targetOf(
  op: RuleFields & { tab?: string },
  context: OperationContext,
): { areas: ResolvedRange[]; tab: SheetTab } {
  const own = op.tab === undefined ? undefined : tabNamed(context.tabs, op.tab)
  const areas = rangesOf(op).map((range) =>
    own === undefined ? resolveRange(context.tabs, range) : resolveOn(context.tabs, range, own),
  )
  const tab = own ?? areas[0]!.tab
  if (areas.some((area) => area.tab.sheetId !== tab.sheetId)) {
    throw new ToolError(
      "invalid_argument",
      `The ranges of one conditional rule must lie on one tab${own === undefined ? "" : `, ${JSON.stringify(own.title)}`}.`,
    )
  }
  return { areas, tab }
}

/** Google's rule for the ranges: a condition with its format, or a gradient between the colors of the scale. */
function ruleOf(op: RuleFields, areas: readonly ResolvedRange[]): Record<string, unknown> {
  const ranges = areas.map(({ grid }) => grid)
  if (op.scale !== undefined) {
    const [lowest, ...rest] = op.scale.map((color) => ({ colorStyle: toColorStyle(color) }))
    const highest = rest.pop()
    return {
      ranges,
      gradientRule: {
        minpoint: { ...lowest, type: "MIN" },
        ...(rest[0] !== undefined && { midpoint: { ...rest[0], type: "PERCENTILE", value: MIDDLE_PERCENTILE } }),
        maxpoint: { ...highest, type: "MAX" },
      },
    }
  }
  return {
    ranges,
    booleanRule: { condition: conditionOf(op.when!, plainValues(op.values), true), format: styleOf(op).format },
  }
}

/** What a rule says of itself: its condition and values, or `color scale`; as a rule Google reports says it. */
function labelOf(op: RuleFields): string {
  if (op.scale !== undefined) return COLOR_SCALE
  return conditionText({ type: op.when, values: plainValues(op.values).map((value) => ({ userEnteredValue: value })) })
}

/** What a rule does, for a description: the ranges and either the condition with the style, or the colors of the scale. */
function ruleWords(op: RuleFields, areas: readonly ResolvedRange[]): string {
  if (op.scale !== undefined) return `${rangesLabel(areas)} ${COLOR_SCALE} ${op.scale.map(normalizedColor).join(" > ")}`
  return `${rangesLabel(areas)} when ${conditionWords(op.when!, plainValues(op.values))}: ${styleOf(op).words.join(", ")}`
}

/** The rule at the number on the tab, as the call's earlier operations will have left the rules; no such rule is `invalid_argument`. */
function ruleAt(context: OperationContext, tab: SheetTab, index: number): RuleState {
  const rules = context.objects.rules.get(tab.sheetId) ?? []
  const rule = rules[index]
  if (rule === undefined) {
    const count =
      rules.length === 0 ? "no conditional rules" : `${rules.length} conditional rule${rules.length === 1 ? "" : "s"}`
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(tab.title)} has ${count}, numbered from 0; there is no rule #${index}.`,
    )
  }
  return rule
}

/** The rules of the tab, which an operation is about to change. */
function rulesToChange(context: OperationContext, sheetId: number): RuleState[] {
  const rules = context.objects.rules.get(sheetId) ?? []
  context.objects.rules.set(sheetId, rules)
  return rules
}

/** `conditional`: adds a rule over the ranges, as the first of the tab's rules, so the numbers of the others go up by one. */
export const conditionalOperation = defineOperation({
  schema: ruleSchema,
  needs: ["objects"],
  requests(op, context) {
    const { areas, tab } = targetOf(op, context)
    rulesToChange(context, tab.sheetId).unshift({ label: labelOf(op) })
    return [{ addConditionalFormatRule: { rule: ruleOf(op, areas), index: 0 } }]
  },
  tabs: (op, context) => tabsOfAreas(targetOf(op, context).areas),
  describe: (op, context) => `conditional ${ruleWords(op, targetOf(op, context).areas)}`,
})

/** `conditional_update`: replaces the rule at a number of a tab's rules with a new one. */
export const conditionalUpdateOperation = defineOperation({
  schema: ruleUpdateSchema,
  needs: ["objects"],
  requests(op, context) {
    const { areas, tab } = targetOf(op, context)
    ruleAt(context, tab, op.index)
    rulesToChange(context, tab.sheetId)[op.index] = { label: labelOf(op) }
    return [{ updateConditionalFormatRule: { sheetId: tab.sheetId, index: op.index, rule: ruleOf(op, areas) } }]
  },
  tabs: (op, context) => tabsOfAreas(targetOf(op, context).areas),
  describe(op, context) {
    const { areas, tab } = targetOf(op, context)
    const current = ruleAt(context, tab, op.index).label
    return `conditional_update #${op.index} of ${quoteTab(tab.title)} (now ${current}) to ${ruleWords(op, areas)}`
  },
  pins(op, context) {
    const { definition } = ruleAt(context, targetOf(op, context).tab, op.index)
    return definition === undefined ? [] : [definition]
  },
})

/** `conditional_delete`: removes the rule at a number of a tab's rules, so the numbers of the later ones go down by one. */
export const conditionalDeleteOperation = defineOperation({
  schema: ruleDeleteSchema,
  needs: ["objects"],
  requests(op, context) {
    const tab = tabNamed(context.tabs, op.tab)
    ruleAt(context, tab, op.index)
    rulesToChange(context, tab.sheetId).splice(op.index, 1)
    return [{ deleteConditionalFormatRule: { sheetId: tab.sheetId, index: op.index } }]
  },
  tabs: (op, { tabs }) => [tabNamed(tabs, op.tab)],
  describe(op, context) {
    const tab = tabNamed(context.tabs, op.tab)
    return `conditional_delete #${op.index} of ${quoteTab(tab.title)} (now ${ruleAt(context, tab, op.index).label})`
  },
  pins(op, context) {
    const { definition } = ruleAt(context, tabNamed(context.tabs, op.tab), op.index)
    return definition === undefined ? [] : [definition]
  },
})
