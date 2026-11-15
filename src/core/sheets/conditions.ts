import { z } from "zod"
import { ToolError } from "../errors"

/** The most values a list of options, hidden values or condition values holds. */
export const MAX_LIST_VALUES = 500

/** How many characters of a value a description shows before it cuts it. */
const SHOWN_VALUE_LENGTH = 20

/** How many values of a list a description shows before it counts the rest. */
const SHOWN_VALUES = 3

/** What a description shows for a value that is empty. */
const EMPTY_VALUE = "(empty)"

/** Google's condition types, which `when` takes as they are (`NUMBER_GREATER`, `TEXT_CONTAINS`, `ONE_OF_LIST`). */
export const CONDITION_TYPES = [
  "NUMBER_GREATER",
  "NUMBER_GREATER_THAN_EQ",
  "NUMBER_LESS",
  "NUMBER_LESS_THAN_EQ",
  "NUMBER_EQ",
  "NUMBER_NOT_EQ",
  "NUMBER_BETWEEN",
  "NUMBER_NOT_BETWEEN",
  "TEXT_CONTAINS",
  "TEXT_NOT_CONTAINS",
  "TEXT_STARTS_WITH",
  "TEXT_ENDS_WITH",
  "TEXT_EQ",
  "TEXT_NOT_EQ",
  "TEXT_IS_EMAIL",
  "TEXT_IS_URL",
  "DATE_EQ",
  "DATE_NOT_EQ",
  "DATE_BEFORE",
  "DATE_AFTER",
  "DATE_ON_OR_BEFORE",
  "DATE_ON_OR_AFTER",
  "DATE_BETWEEN",
  "DATE_NOT_BETWEEN",
  "DATE_IS_VALID",
  "ONE_OF_RANGE",
  "ONE_OF_LIST",
  "BLANK",
  "NOT_BLANK",
  "CUSTOM_FORMULA",
  "BOOLEAN",
] as const

export type ConditionType = (typeof CONDITION_TYPES)[number]

/** The dates a conditional rule may name instead of a date: `TODAY`, `YESTERDAY`. A data validation takes none of them. */
const RELATIVE_DATES = ["PAST_YEAR", "PAST_MONTH", "PAST_WEEK", "YESTERDAY", "TODAY", "TOMORROW"]

/** The conditions whose values are the options of a dropdown: a list, or one range. */
const OPTION_CONDITIONS: readonly ConditionType[] = ["ONE_OF_LIST", "ONE_OF_RANGE"]

/** The conditions whose values are formulas, which Google reads only with a leading `=`. */
const FORMULA_CONDITIONS: readonly ConditionType[] = ["CUSTOM_FORMULA", "ONE_OF_RANGE"]

/** A value of a condition, a list of options or a hidden value: text, a number or a boolean. */
export const listValues = z.array(z.union([z.string(), z.number(), z.boolean()])).max(MAX_LIST_VALUES)

/** The text of a list value as the sheet reads it: a boolean is `TRUE` or `FALSE`, any other value is trimmed. */
export function plainValue(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value).trim()
}

/** The values of a list as text; none for a list left out. */
export function plainValues(values: readonly (string | number | boolean)[] | undefined): string[] {
  return (values ?? []).map(plainValue)
}

/** Whether the condition lists the options of a dropdown. */
export function listsOptions(when: ConditionType): boolean {
  return OPTION_CONDITIONS.includes(when)
}

/** Whether any value names a relative date where the condition compares dates. */
export function hasRelativeDate(when: ConditionType, values: readonly string[]): boolean {
  return when.startsWith("DATE_") && values.some((value) => RELATIVE_DATES.includes(value.toUpperCase()))
}

/**
 * Google's `BooleanCondition` of a type and its values: a formula gets its
 * leading `=`, and a date condition may name a relative date where
 * `relativeDates` is set (a conditional rule), which a data validation refuses.
 */
export function conditionOf(when: ConditionType, values: readonly string[], relativeDates: boolean) {
  const entries = values.map((value) => {
    if (hasRelativeDate(when, [value])) {
      if (!relativeDates) {
        throw new ToolError(
          "invalid_argument",
          `${value} works only in conditional rules; for an input rule use CUSTOM_FORMULA, such as '=C2>=TODAY()'.`,
        )
      }
      return { relativeDate: value.toUpperCase() }
    }
    return { userEnteredValue: FORMULA_CONDITIONS.includes(when) && !value.startsWith("=") ? `=${value}` : value }
  })
  return entries.length > 0 ? { type: when, values: entries } : { type: when }
}

/** A value as a description shows it: whitespace collapsed, cut to a few characters, `(empty)` for none. */
function shownValue(value: string): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text === "") return EMPTY_VALUE
  return text.length > SHOWN_VALUE_LENGTH ? `${text.slice(0, SHOWN_VALUE_LENGTH - 1)}…` : text
}

/** The first few values as a description shows them, and how many more there are: `a, b, c +2`. */
export function fewValues(values: readonly string[]): string {
  const more = values.length - SHOWN_VALUES
  return values.slice(0, SHOWN_VALUES).map(shownValue).join(", ") + (more > 0 ? ` +${more}` : "")
}

/** What a condition says in a description: `BOOLEAN` is a checkbox, a list condition a dropdown, any other the type and its values. */
export function conditionWords(when: ConditionType, values: readonly string[]): string {
  if (when === "BOOLEAN") return `checkbox${values.length > 0 ? ` (${fewValues(values)})` : ""}`
  if (when === "ONE_OF_LIST") return `dropdown (${fewValues(values)})`
  if (when === "ONE_OF_RANGE") return `dropdown from ${fewValues(values)}`
  return `${when}${values.length > 0 ? ` ${fewValues(values)}` : ""}`
}

/** A condition as Google replied with it, as the structure and the descriptions name it: its type and values (`NUMBER_GREATER 5`). */
export function conditionText(
  condition: { type?: string; values?: readonly { userEnteredValue?: string; relativeDate?: string }[] } | undefined,
): string {
  const values = (condition?.values ?? []).map((value) => value.userEnteredValue ?? value.relativeDate ?? "")
  return `${condition?.type ?? ""} ${values.join(", ")}`.trim()
}
