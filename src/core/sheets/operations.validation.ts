import { z } from "zod"
import { ToolError } from "../errors"
import {
  CONDITION_TYPES,
  conditionOf,
  conditionWords,
  hasRelativeDate,
  listsOptions,
  listValues,
  plainValues,
} from "./conditions"
import { defineOperation, type OperationContext } from "./operations"
import { ONE_RANGE_MESSAGE, areasOf, hasOneRange, rangeFields, rangesLabel, tabsOfAreas } from "./operation-ranges"

const MAX_HELP_LENGTH = 500

const validationFields = {
  ...rangeFields,
  when: z
    .enum(CONDITION_TYPES)
    .describe("The condition an input meets: Google's condition type, such as `ONE_OF_LIST` or `NUMBER_BETWEEN`."),
  values: listValues
    .optional()
    .describe("The condition's values: the options of a dropdown, or one range for `ONE_OF_RANGE`."),
  strict: z
    .boolean()
    .optional()
    .describe("`true` (the default) rejects other input; `false` accepts it with a warning."),
  dropdown: z
    .boolean()
    .optional()
    .describe("Whether a list condition shows its options as a dropdown; default `true`."),
  help: z.string().trim().min(1).max(MAX_HELP_LENGTH).optional().describe("The message shown when a cell is selected."),
}

type ValidationFields = z.output<z.ZodObject<typeof validationFields>>

/** The schema of an operation that sets a rule: the ranges, the condition, and how input that does not meet it is treated. */
function validationSchema<Name extends string>(name: Name) {
  return z
    .strictObject({ op: z.literal(name), ...validationFields })
    .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
    .refine((op) => !hasRelativeDate(op.when, plainValues(op.values)), {
      message:
        "A relative date such as `TODAY` works only in conditional rules; for an input rule use `CUSTOM_FORMULA`, such as `=C2>=TODAY()`.",
    })
    .refine((op) => !listsOptions(op.when) || (op.values?.length ?? 0) > 0, {
      message: "A dropdown needs `values`: its options, or one range for `ONE_OF_RANGE`.",
    })
}

const clearSchema = z
  .strictObject({ op: z.literal("validate_clear"), ...rangeFields })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** Google's data validation rule for the operation's condition and settings. */
function ruleOf(op: ValidationFields): Record<string, unknown> {
  return {
    condition: conditionOf(op.when, plainValues(op.values), false),
    strict: op.strict ?? true,
    showCustomUi: (op.dropdown ?? true) && listsOptions(op.when),
    ...(op.help !== undefined && { inputMessage: op.help }),
  }
}

/** What the rule says in a description: its condition, and how other input is treated. */
function ruleWords(op: ValidationFields): string {
  return `${conditionWords(op.when, plainValues(op.values))}, ${(op.strict ?? true) ? "reject other input" : "warn on other input"}`
}

/** The ranges' data validation as read right before the plan. */
function validationOf(op: object, context: OperationContext): unknown[] {
  return context.read.get(op)?.validation?.definitions ?? []
}

/** Refuses a range that already has data validation, naming the operation that replaces it. */
function requireNoValidation(op: ValidationFields, context: OperationContext): void {
  if (validationOf(op, context).length > 0) {
    throw new ToolError(
      "invalid_argument",
      `${rangesLabel(areasOf(op, context.tabs))} already has data validation, and validate sets it only where there is none; to replace it use google_sheets_restructure's validate_replace.`,
    )
  }
}

const wantsValidation = (op: object, context: OperationContext) => ({ validation: areasOf(op, context.tabs) })

/** `validate`: sets a data validation rule on ranges that have none. */
export const validateOperation = defineOperation({
  schema: validationSchema("validate"),
  needs: ["objects"],
  reads: wantsValidation,
  requests(op, context) {
    requireNoValidation(op, context)
    return areasOf(op, context.tabs).map(({ grid }) => ({ setDataValidation: { range: grid, rule: ruleOf(op) } }))
  },
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, context) {
    requireNoValidation(op, context)
    return `validate ${rangesLabel(areasOf(op, context.tabs))} ${ruleWords(op)}`
  },
})

/** `validate_replace`: sets a data validation rule on ranges, replacing the one they have. */
export const validateReplaceOperation = defineOperation({
  schema: validationSchema("validate_replace"),
  needs: ["objects"],
  reads: wantsValidation,
  requests: (op, { tabs }) =>
    areasOf(op, tabs).map(({ grid }) => ({ setDataValidation: { range: grid, rule: ruleOf(op) } })),
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe: (op, { tabs }) => `validate_replace ${rangesLabel(areasOf(op, tabs))} ${ruleWords(op)}`,
  pins: (op, context) => [validationOf(op, context)],
})

/** `validate_clear`: removes the data validation of the ranges. */
export const validateClearOperation = defineOperation({
  schema: clearSchema,
  needs: ["objects"],
  reads: wantsValidation,
  requests: (op, { tabs }) => areasOf(op, tabs).map(({ grid }) => ({ setDataValidation: { range: grid } })),
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe: (op, { tabs }) => `validate_clear ${rangesLabel(areasOf(op, tabs))}`,
  pins: (op, context) => [validationOf(op, context)],
})
