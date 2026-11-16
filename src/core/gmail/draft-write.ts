import { z } from "zod"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import { parseReply } from "../sheets/reply"
import type { ToolBounds, ToolContext } from "../tool"
import type { GmailDraftOutput } from "./draft-args"
import { gmailId } from "./ids"
import type { MailPlan } from "./send-plan"
import { UPLOAD_TIMEOUT_MS, relatedUpload } from "./upload-body"

/** What `drafts.create` and `drafts.update` answer: the draft and its message. */
const writtenReply = z.object({
  id: z.string().optional(),
  message: z.object({ id: z.string().optional(), threadId: z.string().optional() }).optional(),
})

/** The bounds of a tool that writes a mail into a draft. */
export const DRAFT_MAIL_BOUNDS: ToolBounds = {
  attachments: { kind: "allow", description: "Whether a draft may carry attachments." },
}

/** The value of `DRAFT_MAIL_BOUNDS` for a call that writes a mail with `attachments`. */
export function measureDraftMail({ attachments = [] }: { attachments?: readonly string[] }) {
  return { attachments: attachments.length > 0 }
}

/** The name a draft that is not yet made goes by in a target. */
export const NEW_DRAFT = "new"

/** The target `<label>/drafts/<name>` of a call to a draft tool: `NEW_DRAFT`, or the id of the draft it changes. */
export async function draftTarget(args: { account?: string }, ctx: ToolContext, name: string): Promise<string[]> {
  const { label } = await googleSession(ctx, args.account, "Gmail drafts")
  return [`${label}/drafts/${name}`]
}

/** The target of a call that changes the draft `draft_id` names, which must be an id Gmail could have written. */
export function existingDraftTarget(args: { account?: string; draft_id: string }, ctx: ToolContext): Promise<string[]> {
  return draftTarget(args, ctx, gmailId(args.draft_id, "draft id"))
}

/**
 * Takes the planned mail into a draft by the media upload `route`: `metadata`
 * is the JSON part (the draft's `id` when it is replaced, and its message's
 * thread, which a reply joins), the mail the rfc822 part. Returns the ids
 * Google reports, empty where it reports none.
 */
export async function writeDraft(
  plan: MailPlan,
  route: Route,
  draft: { id: string } | undefined,
): Promise<GmailDraftOutput> {
  const metadata = { ...draft, message: plan.original ? { threadId: plan.original.threadId } : {} }
  const reply = parseReply(
    writtenReply,
    await plan.client.request(route, {
      params: draft && { draft_id: draft.id },
      query: { uploadType: "multipart" },
      content: relatedUpload(metadata, plan.mail),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
    "the draft",
  )
  return { draft_id: reply.id ?? "", message_id: reply.message?.id ?? "", thread_id: reply.message?.threadId ?? "" }
}
