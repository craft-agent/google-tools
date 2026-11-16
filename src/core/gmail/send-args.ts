import { z } from "zod"
import { EMAIL_PATTERN, MAX_EMAIL_LENGTH } from "../email"
import { ToolError } from "../errors"
import { gmailId } from "./ids"
import { accountArg, draftIdArg } from "./schemas"

/** The most addresses of `to`, of `cc` and of `bcc`, and of all three together. */
export const MAX_RECIPIENTS = 100

/** The most characters of a mail's text or HTML, and of its subject. */
export const MAX_SEND_BODY_CHARACTERS = 200_000
export const MAX_SUBJECT_LENGTH = 300

/** The most files a mail carries, and the most MiB, and so bytes, of all of them together. */
export const MAX_SEND_ATTACHMENTS = 20
export const MAX_SEND_ATTACHMENT_MIB = 25
export const MAX_SEND_ATTACHMENT_BYTES = MAX_SEND_ATTACHMENT_MIB * 1024 * 1024

/** Printable ASCII, which a header carries as it is. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/

const addressArg = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH)
  .regex(EMAIL_PATTERN, "An address is a plain email address, such as `name@example.com`, with no display name.")
  .regex(PRINTABLE_ASCII, "An address is plain ASCII.")

export const addressList = (min: number, what: string) =>
  z.array(addressArg).min(min).max(MAX_RECIPIENTS).describe(`${what}: up to ${MAX_RECIPIENTS} plain addresses.`)

/** The text of a mail: required for a draft, left out of a send that sends a draft. */
export const bodyArg = z
  .string()
  .min(1)
  .max(MAX_SEND_BODY_CHARACTERS)
  .describe(`The text of the mail, 1 to ${MAX_SEND_BODY_CHARACTERS} characters; HTML when \`html\` is true.`)

/** The arguments of a mail beside `to` and `body`, which a send and a draft take alike. */
export const mailArgs = {
  cc: addressList(0, "Copied recipients, who are seen by all").optional(),
  bcc: addressList(0, "Blind-copied recipients, who are seen by none of the others").optional(),
  subject: z
    .string()
    .min(1)
    .max(MAX_SUBJECT_LENGTH)
    .optional()
    .describe(
      "The subject; needed for a new mail. A reply without one gets `Re: ` and the subject of the mail it answers.",
    ),
  html: z
    .boolean()
    .optional()
    .describe("`true` sends `body` as HTML, with a text version made from it beside it (default false: plain text)."),
  reply_to: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Replies to this message: the `message_id` a read gave. The mail joins its thread and refers to it; the recipients are still the ones given here.",
    ),
  attachments: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SEND_ATTACHMENTS)
    .optional()
    .describe(
      `Files to attach, 1 to ${MAX_SEND_ATTACHMENTS} absolute paths inside the upload directories a person set up (none by default), ${MAX_SEND_ATTACHMENT_MIB} MiB in all.`,
    ),
}

/** The arguments of a mail to send: the mail itself, or a `draft_id` to send as it is, never both. */
export const gmailSendInput = z.strictObject({
  account: accountArg,
  draft_id: draftIdArg
    .optional()
    .describe(
      "Sends this existing draft as it is (the `draft_id` of `google_gmail_read` method `drafts` or of a draft tool) instead of composing a mail; `to`, `cc`, `bcc`, `subject`, `body`, `html`, `reply_to` and `attachments` are then refused. The draft must hold a recipient.",
    ),
  to: addressList(1, "The recipients (needed unless `draft_id` is given)").optional(),
  ...mailArgs,
  body: bodyArg.optional().describe(`${bodyArg.description} Needed unless \`draft_id\` is given.`),
})

export const gmailSendOutput = z.object({
  message_id: z.string().describe("The id of the sent message; empty if Google did not report it."),
  thread_id: z.string().describe("The id of its thread; empty if Google did not report it."),
  labels: z.array(z.string()).describe("The ids of its labels, such as `SENT`."),
})

export type GmailSendArgs = z.output<typeof gmailSendInput>

/** The arguments a mail is planned from, whether it is sent or kept as a draft. */
export type MailArgs = Omit<GmailSendArgs, "draft_id" | "body"> & { body: string }

/** The arguments that make up a mail, which `draft_id` excludes. */
const MAIL_ARGUMENT_NAMES = ["to", "cc", "bcc", "subject", "body", "html", "reply_to", "attachments"] as const

/**
 * What a call to send asks for: the draft `draft_id` names (a valid id), or the
 * mail the arguments make. Both, a draft with any mail argument, and a mail
 * without `to` or `body` are `invalid_argument`.
 */
export function sendModeOf(args: GmailSendArgs): { kind: "draft"; draftId: string } | { kind: "mail"; mail: MailArgs } {
  if (args.draft_id !== undefined) {
    const stray = MAIL_ARGUMENT_NAMES.find((name) => args[name] !== undefined)
    if (stray !== undefined) {
      throw new ToolError(
        "invalid_argument",
        `\`draft_id\` sends the draft as it is, so \`${stray}\` cannot be given with it.`,
      )
    }
    return { kind: "draft", draftId: gmailId(args.draft_id, "draft id") }
  }
  const { body } = args
  if (args.to === undefined || body === undefined) {
    throw new ToolError("invalid_argument", "A mail needs `to` and `body`; to send a draft, give its `draft_id`.")
  }
  return { kind: "mail", mail: { ...args, body } }
}

/** How a recipient is addressed. */
export type RecipientRole = "to" | "cc" | "bcc"

export type Recipient = { address: string; role: RecipientRole }

/** The domain of an address, lower-cased. */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase()
}

/**
 * Every recipient of the call, `to` first, then `cc`, then `bcc`, each as given.
 * An address held twice, in one list or across them (compared lower-cased), or
 * more than `MAX_RECIPIENTS` in all, is `invalid_argument`.
 */
export function recipientsOf(args: Pick<GmailSendArgs, "to" | "cc" | "bcc">): Recipient[] {
  const roles = { to: args.to ?? [], cc: args.cc ?? [], bcc: args.bcc ?? [] }
  const recipients = (Object.keys(roles) as RecipientRole[]).flatMap((role) =>
    roles[role].map((address) => ({ address, role })),
  )
  if (recipients.length > MAX_RECIPIENTS) {
    throw new ToolError(
      "invalid_argument",
      `The mail has ${recipients.length} recipients; at most ${MAX_RECIPIENTS} in to, cc and bcc together.`,
    )
  }
  const seen = new Set<string>()
  for (const { address } of recipients) {
    const key = address.toLowerCase()
    if (seen.has(key)) {
      throw new ToolError(
        "invalid_argument",
        `${address} is a recipient twice; list each address once, in one of to, cc or bcc.`,
      )
    }
    seen.add(key)
  }
  return recipients
}
