import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import type { CallDescription, ToolContext } from "../tool"
import { addressOf, splitAddressList } from "./address-list"
import { fetchDraft } from "./drafts"
import { messageView } from "./message-view"
import { headerOf, type FullMessage } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { MAX_BODY_CHARACTERS } from "./schemas"
import type { Recipient, RecipientRole } from "./send-args"
import { DRAFT_PIN, mailFacts, messageText, sendHeadline, type MailSummary } from "./send-facts"
import { singleLine } from "./send-plan"

/** The header that holds the recipients of each role. */
const ROLE_HEADERS: readonly (readonly [RecipientRole, string])[] = [
  ["to", "To"],
  ["cc", "Cc"],
  ["bcc", "Bcc"],
]

/** A draft read in full, to be sent as it is: what the prompt shows of it, and what the call needs to send it. */
export type DraftMail = MailSummary & {
  client: GoogleClient
  label: string
  draftId: string
  /** Its message's id, which changes each time the draft is edited. */
  messageId: string
}

/** What the prompt shows of a draft that is sent: what it shows of a composed send, taken from the draft, and its message id as a pin. */
export function describeDraftSend(draft: DraftMail): CallDescription {
  return {
    headline: sendHeadline(draft),
    facts: mailFacts(draft),
    text: messageText(draft),
    pins: { [DRAFT_PIN]: draft.messageId },
  }
}

/** The recipients the headers of `message` list, `to` first; a header that is not a list of addresses is `invalid_argument` naming the draft. */
function recipientsOfDraft(message: FullMessage, draftId: string): Recipient[] {
  return ROLE_HEADERS.flatMap(([role, header]) =>
    splitAddressList(headerOf(message.payload, header) ?? "").map((item) => {
      const address = addressOf(item)
      if (address === undefined) {
        throw new ToolError(
          "invalid_argument",
          `The ${header} header of the draft ${draftId} cannot be read as email addresses, so the draft is not sent; edit its recipients first.`,
        )
      }
      return { address, role }
    }),
  )
}

/**
 * Reads the draft to send, in this order: the label's scopes (the draft send
 * route's), then the draft in full. A draft with no recipient is
 * `invalid_argument`. Any failure here fails the call before anything is sent.
 */
export async function planDraftSend(args: { account?: string }, draftId: string, ctx: ToolContext): Promise<DraftMail> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, args.account, "Gmail sending")
  await client.requireScopes(GMAIL_ROUTES.draftSend)
  const { message } = await fetchDraft(client, draftId, "full")
  const recipients = recipientsOfDraft(message, draftId)
  if (recipients.length === 0) {
    throw new ToolError(
      "invalid_argument",
      `The draft ${draftId} has no recipient, so it cannot be sent; edit it to add one first.`,
    )
  }
  const { view } = messageView(message, MAX_BODY_CHARACTERS)
  return {
    client,
    label,
    draftId,
    messageId: message.id,
    recipients,
    subject: singleLine(view.subject ?? ""),
    accountEmail: await client.accountEmail(),
    attachments: view.attachments.map(({ filename, size }) => ({ name: filename, size })),
    size: message.sizeEstimate,
    body: view.body,
  }
}
