import { createHash } from "node:crypto"
import { sizeFact } from "../facts"
import type { CallDescription, CallFact, CallHeadline, CallText, CallValue } from "../tool"
import { domainOf, type Recipient } from "./send-args"
import type { MailPlan, Original } from "./send-plan"
import { GMAIL_WORDS } from "./words"

const BYTES_PER_KIB = 1024
const KIB_PER_MIB = 1024

/** The pin that holds every attachment's content, in order. */
const ATTACHMENTS_PIN = "attachments"

/** The pin that holds the `Message-ID` of the mail replied to. */
const ORIGINAL_PIN = "message_id"

/** The pin that holds the id of a draft's message, which changes each time the draft is edited. */
export const DRAFT_PIN = "draft"

/**
 * The domains the mail goes to that are not the domain of the account's own
 * address, each once, in the order of the recipients; `undefined` when the
 * account's address is not known, so nothing can be told.
 */
export function outsideDomains(addresses: readonly string[], accountEmail: string | null): string[] | undefined {
  if (accountEmail === null) return undefined
  const own = domainOf(accountEmail)
  return [...new Set(addresses.map(domainOf).filter((domain) => domain !== own))]
}

function outsideFact(recipients: readonly Recipient[], accountEmail: string | null): CallFact {
  const domains = outsideDomains(
    recipients.map(({ address }) => address),
    accountEmail,
  )
  const value: CallValue =
    domains === undefined
      ? { text: GMAIL_WORDS.unknown }
      : domains.length === 0
        ? { text: GMAIL_WORDS.no }
        : { text: GMAIL_WORDS.outsideYes, values: { domains: domains.join(", ") } }
  return { label: GMAIL_WORDS.outside, value }
}

/** The `Copies` fact: how many go as copies and as blind copies; none when none do. The addresses are the call's targets, which the prompt shows. */
function copiesFacts(recipients: readonly Recipient[]): CallFact[] {
  const count = (role: Recipient["role"]) => recipients.filter((recipient) => recipient.role === role).length
  const cc = count("cc")
  const bcc = count("bcc")
  if (cc === 0 && bcc === 0) return []
  return [{ label: GMAIL_WORDS.copies, value: { text: GMAIL_WORDS.copiesValue, values: { cc, bcc } } }]
}

/** The subject of the mail replied to, as Google gives it. */
function replyFact({ subject }: Original): CallFact {
  return { label: GMAIL_WORDS.replyTo, value: subject || { text: GMAIL_WORDS.noSubject } }
}

/** A size as `512 B`, `1.5 KiB` or `2.0 MiB`. */
function sizeText(bytes: number): string {
  if (bytes < BYTES_PER_KIB) return `${bytes} B`
  const kib = bytes / BYTES_PER_KIB
  return kib < KIB_PER_MIB ? `${kib.toFixed(1)} KiB` : `${(kib / KIB_PER_MIB).toFixed(1)} MiB`
}

function attachmentsFact(attachments: MailSummary["attachments"]): CallFact {
  return {
    label: GMAIL_WORDS.attachments,
    value: attachments.map(({ name, size }) => `${name} (${sizeText(size)})`).join(", "),
  }
}

/** What the prompt shows of a mail, whether it is composed from arguments or is a draft Google holds. */
export type MailSummary = {
  recipients: readonly Recipient[]
  subject: string
  /** The address the account's credential records, `null` when it records none. */
  accountEmail: string | null
  /** The mail a reply answers; none for a new mail. */
  original?: Original
  attachments: readonly { name: string; size: number }[]
  /** The mail's size in bytes, when it is known. */
  size?: number
  /** The text of the mail as written. */
  body: string
}

/** The summary of a mail composed from arguments, whose `body` is the text the arguments gave. */
export function summaryOf(plan: MailPlan, body: string): MailSummary {
  const { recipients, subject, accountEmail, original, attachments } = plan
  return { recipients, subject, accountEmail, original, attachments, size: plan.mail.length, body }
}

/**
 * The facts every mail shows, in the order they decide: whether it goes
 * outside the account's domain (left out while it has no recipient), how many
 * go as copies, the mail replied to, the attachments and the size. Every
 * recipient is a target of the call, so no fact repeats them.
 */
export function mailFacts(mail: MailSummary): CallFact[] {
  return [
    ...(mail.recipients.length > 0 ? [outsideFact(mail.recipients, mail.accountEmail)] : []),
    ...copiesFacts(mail.recipients),
    ...(mail.original ? [replyFact(mail.original)] : []),
    ...(mail.attachments.length > 0 ? [attachmentsFact(mail.attachments)] : []),
    ...(mail.size === undefined ? [] : [sizeFact(mail.size)]),
  ]
}

/** The headline of a send: the subject and the first `to`, and how many more the mail goes to. */
export function sendHeadline({ recipients, subject }: Pick<MailSummary, "recipients" | "subject">): CallHeadline {
  const [first] = recipients
  const values = { subject, recipient: first?.address ?? "" }
  const more = recipients.length - 1
  return more === 0
    ? { text: GMAIL_WORDS.sendOne, values }
    : { text: GMAIL_WORDS.sendMany, values: { ...values, count: String(more) } }
}

/** The hidden values the call must still find unchanged: one digest of every attachment's SHA-256 (a prompt keeps few pins, and a mail may carry twenty files) and the `Message-ID` of the mail replied to. */
export function pinsOf(plan: Pick<MailPlan, "attachments" | "original">): Record<string, string> {
  return {
    ...(plan.attachments.length > 0 && {
      [ATTACHMENTS_PIN]: createHash("sha256")
        .update(plan.attachments.map((upload) => upload.sha256).join("\n"))
        .digest("hex"),
    }),
    ...(plan.original && { [ORIGINAL_PIN]: plan.original.messageIdHeader }),
  }
}

/**
 * The message as the person reads it: its `To`, `Cc` and `Bcc` lines (each
 * left out when empty) and its subject, then the body as written, so the text
 * section shows who receives it in which role, blind copies included.
 */
export function messageText({ recipients, subject, body }: MailSummary): CallText {
  const line = (header: string, role: Recipient["role"]) => {
    const addresses = recipients.filter((recipient) => recipient.role === role).map((r) => r.address)
    return addresses.length > 0 ? [`${header}: ${addresses.join(", ")}`] : []
  }
  const lines = [...line("To", "to"), ...line("Cc", "cc"), ...line("Bcc", "bcc"), `Subject: ${subject}`, "", body]
  return { label: GMAIL_WORDS.message, body: lines.join("\n") }
}

/** What a description of a composed mail has beside its facts and text: the headline, facts that come first and pins of its own. */
export type MailDescription = { headline: CallHeadline; before?: CallFact[]; pins?: Record<string, string> }

/**
 * What the prompt shows of a composed mail: the headline, any facts that come
 * first, the facts of every mail (`mailFacts`) and the message as written, its
 * address lines first.
 */
export function describeMail(
  plan: MailPlan,
  body: string,
  { headline, before = [], pins = {} }: MailDescription,
): CallDescription {
  const summary = summaryOf(plan, body)
  const allPins = { ...pinsOf(plan), ...pins }
  return {
    headline,
    facts: [...before, ...mailFacts(summary)],
    text: messageText(summary),
    ...(Object.keys(allPins).length > 0 && { pins: allPins }),
  }
}

/** What the prompt shows of a mail to send: its subject and first recipient in the headline, then `describeMail`. */
export function describeSend(plan: MailPlan, body: string): CallDescription {
  return describeMail(plan, body, { headline: sendHeadline(plan) })
}
