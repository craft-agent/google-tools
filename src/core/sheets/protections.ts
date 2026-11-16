import { z } from "zod"
import { ToolError } from "../errors"
import { cut } from "../describe"
import type { GoogleClient } from "../google/client"
import { quoteTab } from "./a1"
import type { GridRange } from "./grid"
import { areaLabel } from "./operation-ranges"
import { parseReply } from "./reply"
import { SHEETS_ROUTES } from "./routes"
import type { ProtectionEditorsView } from "./schemas"
import { listNames, type SheetTab } from "./tabs"

/** What of a protected range the tools read: its range and exceptions, label, kind, editors and whether the account may change it. */
export const PROTECTION_FIELDS =
  "protectedRangeId,range,unprotectedRanges,description,warningOnly," +
  "editors(users,groups,domainUsersCanEdit),requestingUserCanEdit"

const PROTECTIONS_FIELDS = `sheets(properties(sheetId),protectedRanges(${PROTECTION_FIELDS}))`

/** How many characters of a label a line shows. */
const SHOWN_LABEL_LENGTH = 40

/** The editor a line names for the account itself, whose address the tool does not know and which Google always keeps. */
const ACCOUNT_EDITOR = "you (the account)"

/** Google leaves a zero out of its replies, so a number that is missing is 0. */
const gridNumber = z.number().optional()

const gridReply = z.object({
  sheetId: gridNumber,
  startRowIndex: gridNumber,
  endRowIndex: gridNumber,
  startColumnIndex: gridNumber,
  endColumnIndex: gridNumber,
})

/** A protected range of a tab as Google reports it; `editors` is absent when the account cannot see them. */
export const protectedRangeReply = z.object({
  protectedRangeId: gridNumber,
  range: gridReply.optional(),
  unprotectedRanges: z.array(gridReply).optional(),
  description: z.string().optional(),
  warningOnly: z.boolean().optional(),
  editors: z
    .object({
      users: z.array(z.string()).optional(),
      groups: z.array(z.string()).optional(),
      domainUsersCanEdit: z.boolean().optional(),
    })
    .optional(),
  requestingUserCanEdit: z.boolean().optional(),
})

const protectionsReply = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: gridNumber }).optional(),
        protectedRanges: z.array(protectedRangeReply).optional(),
      }),
    )
    .optional(),
})

/** The protected range as Google reports it. */
type ProtectedRangeReply = z.output<typeof protectedRangeReply>

/** Who may edit a protection: the people and groups it names, and whether everyone in the domain may. */
export type ProtectionEditors = { users: string[]; groups: string[]; domainUsersCanEdit: boolean }

/** A protection of the spreadsheet, which operations change as they are built in order, so a later operation plans on what an earlier one will have done. */
export type ProtectionState = {
  /** Google's id; none for a protection the call adds, which is made when the batch runs. */
  protectionId: number | undefined
  /** The protected block, or the whole tab when it names no bounds. */
  range: GridRange
  /** The ranges left editable inside a protection of a whole tab. */
  unprotected: GridRange[]
  description: string | undefined
  warningOnly: boolean
  /** Who may edit; none when Google does not show them to the account. */
  editors: ProtectionEditors | undefined
  /** Whether the account may change or delete the protection, as Google reports it. */
  canEdit: boolean
  /** The protection as Google reported it, which a pin covers. */
  definition: unknown
  /** Whether the call adds or changes it: the protections the call leaves, which the prompt and the result name. */
  changed: boolean
  /** Whether the call sets its editor list, so Google keeps the account itself on it. */
  listed: boolean
}

/** The protection as the tools work with it, from what Google reports. */
export function protectionOf(reply: ProtectedRangeReply): ProtectionState {
  const { editors } = reply
  return {
    protectionId: reply.protectedRangeId ?? 0,
    range: { ...reply.range, sheetId: reply.range?.sheetId ?? 0 },
    unprotected: (reply.unprotectedRanges ?? []).map((range) => ({ ...range, sheetId: range.sheetId ?? 0 })),
    description: reply.description,
    warningOnly: reply.warningOnly ?? false,
    editors:
      editors === undefined
        ? undefined
        : {
            users: editors.users ?? [],
            groups: editors.groups ?? [],
            domainUsersCanEdit: editors.domainUsersCanEdit ?? false,
          },
    canEdit: reply.requestingUserCanEdit ?? false,
    definition: reply,
    changed: false,
    listed: false,
  }
}

/** The protected ranges of the tabs (every tab when none are given) as Google reports them now. */
export async function readProtections(
  client: GoogleClient,
  id: string,
  tabs?: readonly SheetTab[],
): Promise<ProtectionState[]> {
  const reply = parseReply(
    protectionsReply,
    await client.request(SHEETS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: id },
      query: {
        ...(tabs !== undefined && { ranges: tabs.map((tab) => quoteTab(tab.title)) }),
        fields: PROTECTIONS_FIELDS,
      },
    }),
    "the protected ranges",
  )
  return (reply.sheets ?? []).flatMap((sheet) => (sheet.protectedRanges ?? []).map(protectionOf))
}

/** What a line says of who may edit a warning-only protection, which has no editors. */
const WARNING_EDITORS = "anyone who can edit the file, after a warning"

/** What a line says of the people of a domain who may edit. */
const DOMAIN_EDITORS = "everyone in the domain"

/** The addresses of the people and groups who may edit, in full: the people first, then the groups. */
export function editorAddresses({ editors }: Pick<ProtectionState, "editors">): string[] {
  return [...(editors?.users ?? []), ...(editors?.groups ?? [])]
}

/**
 * Who may edit as a line says it, every editor in full: the account itself
 * first when the call sets the list (Google always keeps it), then the people,
 * the groups and the whole domain where it may.
 */
export function editorsText(protection: Pick<ProtectionState, "warningOnly" | "editors" | "listed">): string {
  if (protection.warningOnly) return WARNING_EDITORS
  const { editors, listed } = protection
  if (editors === undefined && !listed) return "not shown by Google"
  return [
    ...(listed ? [ACCOUNT_EDITOR] : []),
    ...(editors?.users ?? []),
    ...(editors?.groups ?? []).map((group) => `${group} (group)`),
    ...(editors?.domainUsersCanEdit === true ? [DOMAIN_EDITORS] : []),
  ].join(", ")
}

/** The editors as a result lists them, every address in full; none shown is an empty list. */
export function editorsView({ editors }: Pick<ProtectionState, "editors">): ProtectionEditorsView {
  return {
    users: editors?.users ?? [],
    groups: editors?.groups ?? [],
    domain_users_can_edit: editors?.domainUsersCanEdit ?? false,
  }
}

/** The protected range in A1 notation with the tab's title; a whole tab is its title. */
export function protectionRange(tabs: readonly Pick<SheetTab, "sheetId" | "title">[], range: GridRange): string {
  return areaLabel({ tab: { title: tabs.find((tab) => tab.sheetId === range.sheetId)?.title ?? "" }, grid: range })
}

/** How a protection is named in a line or an error: its id, then its label in quotes. */
export function protectionName(protection: Pick<ProtectionState, "protectionId" | "description">): string {
  const label = protection.description
  return `#${protection.protectionId}${label === undefined || label === "" ? "" : ` ${JSON.stringify(cut(label, SHOWN_LABEL_LENGTH))}`}`
}

/**
 * The protection the key names (id, else label, else label ignoring case)
 * among the protections Google reported that lie on a tab the call still has;
 * `forbidden` when the account cannot change it. An unknown or ambiguous key is
 * `invalid_argument` listing up to 20 protections.
 */
export function findProtection(
  tabs: readonly SheetTab[],
  protections: readonly ProtectionState[],
  key: string | number,
): ProtectionState {
  const known = protections.filter(
    (protection) =>
      protection.protectionId !== undefined && tabs.some((tab) => tab.sheetId === protection.range.sheetId),
  )
  const wanted = String(key)
  const lowered = wanted.toLowerCase()
  const steps = [
    known.filter((protection) => String(protection.protectionId) === wanted),
    known.filter((protection) => protection.description === wanted),
    known.filter((protection) => (protection.description ?? "").toLowerCase() === lowered),
  ]
  const matches = steps.find((step) => step.length > 0) ?? []
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new ToolError(
      "invalid_argument",
      `${matches.length === 0 ? "No protection matches" : "Several protections match"} ${JSON.stringify(cut(wanted, SHOWN_LABEL_LENGTH))}; the spreadsheet's protections are: ${listNames(known.map(protectionName))}. Give a protection's id or its exact label.`,
    )
  }
  if (!match.canEdit) {
    throw new ToolError(
      "forbidden",
      `The account cannot edit the protection ${protectionName(match)}, so it cannot change or delete it.`,
    )
  }
  return match
}
