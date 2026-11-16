import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { splitAddressList } from "./address-list"
import type { GmailDraftCreateArgs, GmailDraftDeleteArgs, GmailDraftEditArgs } from "./draft-args"
import { fetchDraft } from "./drafts"
import { gmailId } from "./ids"
import { headerOf } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_TOOLSET } from "./scopes"
import { planMail, singleLine, type MailPlan } from "./send-plan"

/** What the draft tools name their work as when a call has no runtime. */
const DRAFTS_WORK = "Gmail drafts"

/** The headers that hold a draft's recipients. */
const RECIPIENT_HEADERS = ["To", "Cc", "Bcc"]

/** A draft as Google holds it now, read from its headers alone. */
export type CurrentDraft = {
  draftId: string
  /** Its message's id, which changes each time the draft is edited. */
  messageId: string
  /** Its subject as one line; empty when it has none. */
  subject: string
  /** Its `To` header as one line, as Google reports it. */
  to: string | null
  date: string | null
  /** How many recipients its `To`, `Cc` and `Bcc` headers list. */
  recipientCount: number
}

/** A draft that is replaced: the mail it is replaced with, and what it holds now. */
export type DraftEditPlan = MailPlan & { current: CurrentDraft }

/** A draft that is deleted, and what it holds now. */
export type DraftDeletePlan = { client: GoogleClient; label: string; current: CurrentDraft }

/** The draft `draftId` as it is now. */
async function readCurrentDraft(client: GoogleClient, draftId: string): Promise<CurrentDraft> {
  const { message } = await fetchDraft(client, draftId, "metadata")
  const oneLine = (name: string) => {
    const value = headerOf(message.payload, name)
    return value === null ? null : singleLine(value)
  }
  return {
    draftId,
    messageId: message.id,
    subject: oneLine("Subject") ?? "",
    to: oneLine("To"),
    date: oneLine("Date"),
    recipientCount: RECIPIENT_HEADERS.flatMap((name) => splitAddressList(headerOf(message.payload, name) ?? "")).length,
  }
}

/** Plans the mail of a new draft as a send plans its own; a draft may hold no recipient. */
export function planDraftCreate(args: GmailDraftCreateArgs, ctx: ToolContext): Promise<MailPlan> {
  return planMail(args, ctx, GMAIL_ROUTES.draftCreate, DRAFTS_WORK)
}

/** Plans the new message of a draft like a new draft's, and reads the draft it replaces, after the label's scopes are checked. */
export async function planDraftEdit(args: GmailDraftEditArgs, ctx: ToolContext): Promise<DraftEditPlan> {
  const draftId = gmailId(args.draft_id, "draft id")
  const plan = await planMail(args, ctx, GMAIL_ROUTES.draftUpdate, DRAFTS_WORK)
  return { ...plan, current: await readCurrentDraft(plan.client, draftId) }
}

/** Reads the draft to delete, after the draft id and the label's scopes are checked. */
export async function planDraftDelete(args: GmailDraftDeleteArgs, ctx: ToolContext): Promise<DraftDeletePlan> {
  const draftId = gmailId(args.draft_id, "draft id")
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, args.account, DRAFTS_WORK, GMAIL_TOOLSET)
  await client.requireScopes(GMAIL_ROUTES.draftDelete)
  return { client, label, current: await readCurrentDraft(client, draftId) }
}
