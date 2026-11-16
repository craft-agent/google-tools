import { ToolError } from "../errors"
import type { GmailLabel } from "./schemas"

/** The system labels a call may add or remove, named by their ids. */
const CHANGEABLE_SYSTEM_LABELS: readonly string[] = [
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]

/** The system labels no label change touches, each with what to do instead. */
const REFUSED_SYSTEM_LABELS: Readonly<Record<string, string>> = {
  TRASH: "moving mail to the trash has its own tool, `google_gmail_trash` (and `untrash` of this tool moves it back)",
  SPAM: "spam is not changed by labels",
  DRAFT: "drafts are not changed by labels",
  SENT: "sent mail is not changed by labels",
  CHAT: "chats are not changed by labels",
}

/** The most user labels an error lists. */
const MAX_LISTED_LABELS = 20

/** A label as a call resolved it: its id, and its name as Google names it. */
export type ResolvedLabel = { id: string; name: string }

function listUserLabels(userLabels: readonly GmailLabel[]): string {
  if (userLabels.length === 0) return "The account has no labels of its own."
  const shown = userLabels.slice(0, MAX_LISTED_LABELS).map((label) => JSON.stringify(label.name))
  const rest = userLabels.length - shown.length
  return `The account's own labels are ${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}.`
}

/**
 * The label that `reference` names among `labels`: a system id of
 * `CHANGEABLE_SYSTEM_LABELS`, else a user label by id, by exact name, or by
 * name ignoring case when only one label matches. `invalid_argument` for one
 * of the refused system ids, for a name that matches several labels ignoring
 * case, and for one that matches none, which lists the user labels.
 */
export function resolveLabel(reference: string, labels: readonly GmailLabel[]): ResolvedLabel {
  if (Object.hasOwn(REFUSED_SYSTEM_LABELS, reference)) {
    throw new ToolError(
      "invalid_argument",
      `The label ${reference} cannot be changed: ${REFUSED_SYSTEM_LABELS[reference]}.`,
    )
  }
  if (CHANGEABLE_SYSTEM_LABELS.includes(reference)) {
    return { id: reference, name: labels.find((label) => label.label_id === reference)?.name ?? reference }
  }
  const userLabels = labels.filter((label) => label.type === "user")
  const exact = userLabels.find((label) => label.label_id === reference || label.name === reference)
  if (exact) return { id: exact.label_id, name: exact.name }
  const folded = userLabels.filter((label) => label.name.toLowerCase() === reference.toLowerCase())
  if (folded.length === 1) return { id: folded[0]!.label_id, name: folded[0]!.name }
  if (folded.length > 1) {
    const names = folded.map((label) => `${JSON.stringify(label.name)} (${label.label_id})`).join(", ")
    throw new ToolError(
      "invalid_argument",
      `The label ${JSON.stringify(reference)} matches more than one label: ${names}; give an id.`,
    )
  }
  throw new ToolError(
    "invalid_argument",
    `There is no label ${JSON.stringify(reference)}. ${listUserLabels(userLabels)} \`google_gmail_label_create\` makes a new one.`,
  )
}
