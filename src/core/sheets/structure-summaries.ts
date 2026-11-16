import { columnLetters } from "./a1"
import { colorOf } from "./colors"
import { conditionText, fewValues } from "./conditions"

type Color = Parameters<typeof colorOf>[0]

/** The part of a conditional rule's format the structure summarizes, as Google replies with it. */
export type RuleFormat = {
  textFormat?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    foregroundColor?: Color
    foregroundColorStyle?: Color
  }
  backgroundColor?: Color
  backgroundColorStyle?: Color
}

/** One point of a gradient rule: its color. */
type GradientPoint = { color?: Color; colorStyle?: Color }

type RuleReply = {
  booleanRule?: { format?: RuleFormat }
  gradientRule?: { minpoint?: GradientPoint; midpoint?: GradientPoint; maxpoint?: GradientPoint }
}

/** One column's criteria of a filter, as Google replies with them. */
export type FilterSpecReply = {
  columnIndex?: number
  filterCriteria?: {
    hiddenValues?: string[]
    condition?: { type?: string; values?: { userEnteredValue?: string; relativeDate?: string }[] }
  }
}

/** The format a boolean rule applies, in the words the `conditional` operation takes (`bold, background #ff0000`); `undefined` for a format that sets none of them. */
function formatSummary({ textFormat, backgroundColor, backgroundColorStyle }: RuleFormat): string | undefined {
  const flags = (["bold", "italic", "strikethrough"] as const).flatMap((flag) =>
    textFormat?.[flag] === undefined ? [] : [textFormat[flag] ? flag : `no ${flag}`],
  )
  const color = colorOf(textFormat?.foregroundColorStyle) ?? colorOf(textFormat?.foregroundColor)
  const background = colorOf(backgroundColorStyle) ?? colorOf(backgroundColor)
  const words = [
    ...flags,
    ...(color === undefined ? [] : [`color ${color}`]),
    ...(background === undefined ? [] : [`background ${background}`]),
  ]
  return words.length === 0 ? undefined : words.join(", ")
}

/** What a rule does to the cells that meet it: its format's words, or a gradient's colors from the lowest value up; `undefined` when Google reports none. */
export function ruleSummary(rule: RuleReply): string | undefined {
  if (rule.booleanRule !== undefined) return formatSummary(rule.booleanRule.format ?? {})
  const { minpoint, midpoint, maxpoint } = rule.gradientRule ?? {}
  const colors = [minpoint, midpoint, maxpoint].flatMap((point) => {
    const color = colorOf(point?.colorStyle) ?? colorOf(point?.color)
    return color === undefined ? [] : [color]
  })
  return colors.length === 0 ? undefined : colors.join(" > ")
}

/** The criteria of a filter, one entry per column: `C hide (a, b), show TEXT_CONTAINS x`. */
export function criteriaSummaries(specs: readonly FilterSpecReply[] | undefined): string[] {
  return (specs ?? []).map((spec) => {
    const hidden = spec.filterCriteria?.hiddenValues ?? []
    const condition = spec.filterCriteria?.condition
    const words = [
      ...(hidden.length === 0 ? [] : [`hide (${fewValues(hidden)})`]),
      ...(condition === undefined ? [] : [`show ${conditionText(condition)}`]),
    ]
    return `${columnLetters(spec.columnIndex ?? 0)} ${words.join(", ")}`.trimEnd()
  })
}
