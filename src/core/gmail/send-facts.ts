import { createHash } from "node:crypto"
import { sizeFact } from "../facts"
import type { CallDescription, CallFact, CallValue } from "../tool"
import { domainOf, type Recipient } from "./send-args"
import type { Original, SendPlan } from "./send-plan"
import { GMAIL_WORDS } from "./words"

const BYTES_PER_KIB = 1024
const KIB_PER_MIB = 1024

/** The pin that holds every attachment's content, in order. */
const ATTACHMENTS_PIN = "attachments"

/** The pin that holds the `Message-ID` of the mail replied to. */
const ORIGINAL_PIN = "message_id"

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

function attachmentsFact(attachments: SendPlan["attachments"]): CallFact {
  return {
    label: GMAIL_WORDS.attachments,
    value: attachments.map(({ name, size }) => `${name} (${sizeText(size)})`).join(", "),
  }
}

/** The headline: the subject and the first `to`, and how many more the mail goes to. */
function headlineOf(plan: SendPlan): CallDescription["headline"] {
  const [first] = plan.recipients
  const values = { subject: plan.subject, recipient: first?.address ?? "" }
  const more = plan.recipients.length - 1
  return more === 0
    ? { text: GMAIL_WORDS.sendOne, values }
    : { text: GMAIL_WORDS.sendMany, values: { ...values, count: String(more) } }
}

/** The hidden values the call must still find unchanged: one digest of every attachment's SHA-256 (a prompt keeps few pins, and a mail may carry twenty files) and the `Message-ID` of the mail replied to. */
function pinsOf(plan: SendPlan): Record<string, string> {
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
function messageText(plan: SendPlan, body: string): string {
  const line = (header: string, role: Recipient["role"]) => {
    const addresses = plan.recipients.filter((recipient) => recipient.role === role).map((r) => r.address)
    return addresses.length > 0 ? [`${header}: ${addresses.join(", ")}`] : []
  }
  return [...line("To", "to"), ...line("Cc", "cc"), ...line("Bcc", "bcc"), `Subject: ${plan.subject}`, "", body].join(
    "\n",
  )
}

/**
 * What the prompt shows of a mail: its subject and first recipient in the
 * headline, whether it goes outside the account's domain, how many go as
 * copies, the mail replied to, the attachments, its size, and the message as
 * written, its address lines first. Every recipient is a target of the call,
 * so no fact repeats them.
 */
export function describeSend(plan: SendPlan, body: string): CallDescription {
  const pins = pinsOf(plan)
  return {
    headline: headlineOf(plan),
    facts: [
      outsideFact(plan.recipients, plan.accountEmail),
      ...copiesFacts(plan.recipients),
      ...(plan.original ? [replyFact(plan.original)] : []),
      ...(plan.attachments.length > 0 ? [attachmentsFact(plan.attachments)] : []),
      sizeFact(plan.mail.length),
    ],
    text: { label: GMAIL_WORDS.message, body: messageText(plan, body) },
    ...(Object.keys(pins).length > 0 && { pins }),
  }
}
