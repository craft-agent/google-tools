import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import type { GmailLabelArgs } from "./label-args"
import { resolveLabel, type ResolvedLabel } from "./label-names"
import { readLabels } from "./labels"
import { selectMail, type MailSelection } from "./mail-items"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_TOOLSET } from "./scopes"
import type { GmailLabel } from "./schemas"

/** What the label tools name their work as when a call has no runtime. */
export const LABELS_WORK = "Gmail labels"

/** A label change planned: the mail it changes, the labels it adds and removes as Google names them, and whether it first takes the mail out of the trash. */
export type LabelPlan = {
  client: GoogleClient
  label: string
  selection: MailSelection
  adds: ResolvedLabel[]
  removes: ResolvedLabel[]
  untrash: boolean
}

/** `references` resolved against the mailbox's `labels`, each label once. */
function resolveAll(references: readonly string[], labels: readonly GmailLabel[]): ResolvedLabel[] {
  const resolved = references.map((reference) => resolveLabel(reference, labels))
  return resolved.filter((label, index) => resolved.findIndex((other) => other.id === label.id) === index)
}

/**
 * Reads and checks what a label change is made of, in this order: the
 * arguments (the mail, and that something changes), the label's scopes, the
 * mailbox's labels (read once, and only when the call names labels) and the
 * names resolved to ids. Any failure here fails the call before anything is
 * written.
 */
export async function planLabel(args: GmailLabelArgs, ctx: ToolContext): Promise<LabelPlan> {
  const selection = selectMail(args)
  const untrash = args.untrash === true
  if (args.add_labels === undefined && args.remove_labels === undefined && !untrash) {
    throw new ToolError("invalid_argument", "Give at least one of `add_labels`, `remove_labels` and `untrash`.")
  }
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, args.account, LABELS_WORK, GMAIL_TOOLSET)
  await client.requireScopes(
    selection.kind === "messages" ? GMAIL_ROUTES.messagesBatchModify : GMAIL_ROUTES.threadModify,
  )

  const named = [...(args.add_labels ?? []), ...(args.remove_labels ?? [])]
  const labels = named.length === 0 ? [] : (await readLabels(client)).labels
  const adds = resolveAll(args.add_labels ?? [], labels)
  const removes = resolveAll(args.remove_labels ?? [], labels)
  const both = adds.find((added) => removes.some((removed) => removed.id === added.id))
  if (both) {
    throw new ToolError(
      "invalid_argument",
      `The label ${JSON.stringify(both.name)} is in both \`add_labels\` and \`remove_labels\`.`,
    )
  }
  return { client, label, selection, adds, removes, untrash }
}
