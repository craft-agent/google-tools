import { z } from "zod"
import { ToolError } from "../errors"
import { cut } from "../describe"
import type { GridRange } from "./grid"
import { defineOperation, type OperationContext } from "./operations"
import { areaLabel, areasOf, rangeText, resolveOn, tabsOfAreas } from "./operation-ranges"
import { tabWithId } from "./operations.tabs"
import {
  MAX_EDITORS,
  distinctEditors,
  editorList,
  protectionFields,
  protectionKey,
  warningWithoutEditors,
} from "./protect-args"
import { editorsText, findProtection, protectionName, protectionRange, type ProtectionState } from "./protections"
import { shownRange, type SheetTab } from "./tabs"

/** How many characters of a label a line shows. */
const SHOWN_LABEL_LENGTH = 40

const protectSchema = z
  .strictObject({
    op: z.literal("protect"),
    range: rangeText.describe(
      "What to protect: a block (`Plan!A1:C20`, `Plan!B:B`) or a whole tab, by its title alone (`Plan`).",
    ),
    ...protectionFields,
    editors: editorList
      .optional()
      .describe(
        `Up to ${MAX_EDITORS} email addresses that may edit besides you, who are always kept as an editor; an empty list or none leaves only you.`,
      ),
  })
  .refine(({ warning_only, editors }) => warning_only !== true || editors === undefined, {
    message: "A warning-only protection has no editors: anyone who can edit the file may edit after the warning.",
  })

const protectUpdateSchema = warningWithoutEditors(
  z
    .strictObject({
      op: z.literal("protect_update"),
      protection: protectionKey,
      range: rangeText
        .optional()
        .describe("The protection's new range, a block or a whole tab; no tab means the protection's own tab."),
      ...protectionFields,
      editors: editorList
        .optional()
        .describe(
          `Replaces the whole editor list with up to ${MAX_EDITORS} email addresses, dropping every group and the domain's access; you stay an editor, and an empty list leaves only you. It makes the protection block instead of warn.`,
        ),
      add_editors: editorList
        .min(1)
        .optional()
        .describe("Email addresses to add to the editors the protection has now."),
      remove_editors: editorList
        .min(1)
        .optional()
        .describe("Email addresses to take off the editors the protection has now; you always stay an editor."),
    })
    .refine(
      (op) =>
        [op.range, op.except, op.label, op.warning_only, op.editors, op.add_editors, op.remove_editors].some(
          (part) => part !== undefined,
        ),
      {
        message:
          "Give `range`, `except`, `label`, `warning_only`, `editors`, `add_editors` or `remove_editors` to change.",
      },
    )
    .refine((op) => op.editors === undefined || (op.add_editors === undefined && op.remove_editors === undefined), {
      message: "Give `editors`, which replaces the list, or `add_editors` and `remove_editors`, not both.",
    })
    .refine((op) => (op.add_editors ?? []).every((address) => !(op.remove_editors ?? []).includes(address)), {
      message: "An address is in both `add_editors` and `remove_editors`.",
    })
    .refine((op) => op.warning_only !== false || op.editors !== undefined, {
      message:
        "Turning the warning off needs `editors` ([] = only you): without them Google lets everyone who can edit the file edit there.",
    }),
)

const protectDeleteSchema = z.strictObject({ op: z.literal("protect_delete"), protection: protectionKey })

/** Whether the range names no bounds, so it is the whole tab. */
function isWholeTab(range: GridRange): boolean {
  return Object.entries(range).every(([key, bound]) => key === "sheetId" || bound === undefined)
}

/** The ranges left editable, each a block of the protected tab; any other is refused. */
function exceptions(ranges: readonly string[], tab: SheetTab, tabs: readonly SheetTab[]): GridRange[] {
  return ranges.map((range) => {
    const { tab: own, grid } = resolveOn(tabs, range, tab)
    if (own.sheetId !== tab.sheetId || isWholeTab(grid)) {
      throw new ToolError(
        "invalid_argument",
        `\`except\` takes cell ranges on the protected tab ${JSON.stringify(tab.title)}, such as \`B2:B20\`; ${JSON.stringify(shownRange(range))} is not one.`,
      )
    }
    return grid
  })
}

/** Refuses `except` for a protection of a block: only a protection of a whole tab has ranges left editable. */
function requireWholeTab(range: GridRange, tab: SheetTab): void {
  if (!isWholeTab(range)) {
    throw new ToolError(
      "invalid_argument",
      `\`except\` goes with a protection of a whole tab (\`range\` is the tab's title), not ${JSON.stringify(areaLabel({ tab, grid: range }))}.`,
    )
  }
}

/** The ranges as a line shows them, in A1 notation with the tab. */
function rangeList(ranges: readonly GridRange[], tabs: readonly SheetTab[]): string {
  return ranges.map((range) => protectionRange(tabs, range)).join(", ")
}

/** A label as a line quotes it. */
function labelWords(description: string | undefined): string {
  return description === undefined ? "no label" : `labelled ${JSON.stringify(cut(description, SHOWN_LABEL_LENGTH))}`
}

/** What `protect` works out before it changes anything: the range, the ranges left editable, and the protection it will make. */
function planProtect(op: z.output<typeof protectSchema>, context: OperationContext) {
  const area = areasOf(op, context.tabs)[0]!
  const wholeTab = isWholeTab(area.grid)
  if (op.except !== undefined) requireWholeTab(area.grid, area.tab)
  const unprotected = op.except === undefined ? [] : exceptions(op.except, area.tab, context.tabs)
  const warningOnly = op.warning_only ?? false
  const users = distinctEditors(op.editors ?? [])
  const after: ProtectionState = {
    protectionId: undefined,
    range: area.grid,
    unprotected,
    description: op.label === undefined || op.label === "" ? undefined : op.label,
    warningOnly,
    editors: warningOnly ? undefined : { users, groups: [], domainUsersCanEdit: false },
    canEdit: true,
    definition: undefined,
    changed: true,
    listed: !warningOnly,
  }
  return { area, wholeTab, users, after }
}

/** `protect`: protects a block or a whole tab, with who may edit it; Google always keeps the account itself as an editor. */
export const protectOperation = defineOperation({
  schema: protectSchema,
  needs: ["protections"],
  requests(op, context) {
    const { users, after } = planProtect(op, context)
    context.protections.push(after)
    return [
      {
        addProtectedRange: {
          protectedRange: {
            range: after.range,
            ...(after.unprotected.length > 0 && { unprotectedRanges: after.unprotected }),
            ...(after.description !== undefined && { description: after.description }),
            warningOnly: after.warningOnly,
            ...(op.editors !== undefined && { editors: { users } }),
          },
        },
      },
    ]
  },
  tabs: (op, context) => tabsOfAreas([planProtect(op, context).area]),
  describe(op, context) {
    const { area, wholeTab, after } = planProtect(op, context)
    const words = [
      ...(after.unprotected.length > 0 ? [`except ${rangeList(after.unprotected, context.tabs)}`] : []),
      ...(after.description === undefined ? [] : [labelWords(after.description)]),
    ]
    return `protect ${wholeTab ? "the whole tab " : ""}${areaLabel(area)}${words.map((word) => `; ${word}`).join("")}; editors: ${editorsText(after)}`
  },
})

/** The editors of a protection after an add and a remove: the ones left of the current list, then the ones added that it lacks. */
function editedUsers(current: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const kept = current.filter((user) => !remove.includes(user.toLowerCase()))
  const known = new Set(kept.map((user) => user.toLowerCase()))
  return [...kept, ...distinctEditors(add).filter((address) => !known.has(address))]
}

/** What `protect_update` works out before it changes anything: the protection, its range, and the state and the changes it will have. */
function planUpdate(op: z.output<typeof protectUpdateSchema>, context: OperationContext) {
  const current = findProtection(context.tabs, context.protections, op.protection)
  const own = tabWithId(context.tabs, current.range.sheetId)
  const area = op.range === undefined ? undefined : resolveOn(context.tabs, op.range, own)
  const range = area?.grid ?? current.range
  const tab = area?.tab ?? own
  if (op.except !== undefined) requireWholeTab(range, tab)
  const unprotected = op.except === undefined ? current.unprotected : exceptions(op.except, tab, context.tabs)
  const edits = op.add_editors !== undefined || op.remove_editors !== undefined
  if (edits && current.warningOnly) {
    throw new ToolError(
      "invalid_argument",
      `The protection ${protectionName(current)} only warns, so it has no editors to add or remove; give \`editors\` and \`warning_only: false\` to make it block.`,
    )
  }
  if (edits && current.editors === undefined) {
    throw new ToolError(
      "invalid_argument",
      `Google does not show the editors of the protection ${protectionName(current)}, so editors cannot be added or removed; give \`editors\` to replace them.`,
    )
  }
  const editors =
    op.editors !== undefined
      ? { users: distinctEditors(op.editors), groups: [], domainUsersCanEdit: false }
      : edits
        ? {
            ...current.editors!,
            users: editedUsers(current.editors!.users, op.add_editors ?? [], op.remove_editors ?? []),
          }
        : current.editors
  const after: ProtectionState = {
    ...current,
    range,
    unprotected,
    description: op.label === undefined ? current.description : op.label === "" ? undefined : op.label,
    warningOnly: op.warning_only ?? (op.editors === undefined ? current.warningOnly : false),
    editors,
    changed: true,
    listed: current.listed || op.editors !== undefined,
  }
  return { current, own, area, edits, after }
}

/** The part of a protection's editors a `protect_update` sends: the people, and the groups and the domain's access where the protection has them. */
function editorsBody({ users, groups, domainUsersCanEdit }: NonNullable<ProtectionState["editors"]>) {
  return { users, ...(groups.length > 0 && { groups }), ...(domainUsersCanEdit && { domainUsersCanEdit }) }
}

/** `protect_update`: changes a protection's range, exceptions, label, kind or editors; what is not given stays as it is. */
export const protectUpdateOperation = defineOperation({
  schema: protectUpdateSchema,
  needs: ["protections"],
  requests(op, context) {
    const { current, area, edits, after } = planUpdate(op, context)
    const sets = {
      range: area !== undefined,
      unprotectedRanges: op.except !== undefined,
      description: op.label !== undefined,
      warningOnly: op.warning_only !== undefined || op.editors !== undefined,
      editors: op.editors !== undefined || edits,
    }
    const protectedRange = {
      protectedRangeId: current.protectionId,
      ...(sets.range && { range: after.range }),
      ...(sets.unprotectedRanges && { unprotectedRanges: after.unprotected }),
      ...(sets.description && { description: op.label }),
      ...(sets.warningOnly && { warningOnly: after.warningOnly }),
      ...(sets.editors && { editors: editorsBody(after.editors!) }),
    }
    Object.assign(current, after)
    return [
      {
        updateProtectedRange: {
          protectedRange,
          fields: Object.entries(sets)
            .filter(([, set]) => set)
            .map(([field]) => field)
            .join(","),
        },
      },
    ]
  },
  tabs(op, context) {
    const { current, own, area } = planUpdate(op, context)
    return tabsOfAreas([{ tab: own, grid: current.range }, ...(area === undefined ? [] : [area])])
  },
  describe(op, context) {
    const { current, after } = planUpdate(op, context)
    const words = [
      ...(op.range === undefined ? [] : [`range ${protectionRange(context.tabs, after.range)}`]),
      ...(op.except === undefined
        ? []
        : [after.unprotected.length === 0 ? "no exceptions" : `except ${rangeList(after.unprotected, context.tabs)}`]),
      ...(op.label === undefined ? [] : [labelWords(after.description)]),
      ...(op.warning_only === undefined ? [] : [op.warning_only ? "warning only" : "blocking"]),
      ...(op.editors === undefined ? [] : ["replace the editors"]),
      ...(op.add_editors === undefined ? [] : [`add editors ${op.add_editors.join(", ")}`]),
      ...(op.remove_editors === undefined
        ? []
        : [`remove editors ${op.remove_editors.join(", ")} (the account itself always stays)`]),
    ]
    return `protect_update ${protectionName(current)}${words.length === 0 ? "" : `: ${words.join(", ")}`}; editors: ${editorsText(after)}`
  },
  pins: (op, context) => [planUpdate(op, context).current.definition],
})

/** `protect_delete`: removes a protection; another protection over the same cells still applies. */
export const protectDeleteOperation = defineOperation({
  schema: protectDeleteSchema,
  needs: ["protections"],
  requests(op, context) {
    const current = findProtection(context.tabs, context.protections, op.protection)
    context.protections = context.protections.filter((protection) => protection !== current)
    return [{ deleteProtectedRange: { protectedRangeId: current.protectionId } }]
  },
  tabs: (op, context) => [
    tabWithId(context.tabs, findProtection(context.tabs, context.protections, op.protection).range.sheetId),
  ],
  describe(op, context) {
    const current = findProtection(context.tabs, context.protections, op.protection)
    return `protect_delete ${protectionName(current)} (${protectionRange(context.tabs, current.range)}; any other protection over those cells still applies)`
  },
  pins: (op, context) => [findProtection(context.tabs, context.protections, op.protection).definition],
})
