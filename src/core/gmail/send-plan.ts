import { ToolError } from "../errors"
import { abortError } from "../exec"
import { readUpload, uploadDirsOf, type Upload } from "../files/upload"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import { parseReply } from "../sheets/reply"
import type { ToolContext } from "../tool"
import { gmailId } from "./ids"
import { buildMime } from "./mime"
import { fullMessageSchema, headerOf } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_TOOLSET } from "./scopes"
import {
  MAX_SEND_ATTACHMENT_BYTES,
  MAX_SEND_ATTACHMENT_MIB,
  recipientsOf,
  type MailArgs,
  type Recipient,
} from "./send-args"

/** The headers of the original a reply needs. */
const ORIGINAL_HEADERS = ["Message-ID", "References", "Subject"]

/** What a reply's subject starts with, and what is put there when it does not. */
const REPLY_PREFIX = /^re:/i
const REPLY_MARK = "Re: "

/** The mail a reply answers, as Google reports it. */
export type Original = {
  /** Its thread, which the reply joins. */
  threadId: string
  /** Its RFC `Message-ID`, which the reply refers to. */
  messageIdHeader: string
  /** Its `References`, which the reply extends. */
  references: string | null
  subject: string | null
}

/** Everything the mail is made of, read and checked: describing, targeting and writing it (as a send or as a draft) all plan with this. */
export type MailPlan = {
  client: GoogleClient
  label: string
  recipients: Recipient[]
  /** The subject the mail goes with. */
  subject: string
  /** The mail a reply answers; none for a new mail. */
  original?: Original
  attachments: Upload[]
  /** The address the account's credential records, `null` when it records none. */
  accountEmail: string | null
  /** The mail as RFC 5322 bytes. */
  mail: Uint8Array
}

/** `text` with every run of white space, line breaks included, as one space, and trimmed. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** The mail `messageId` names: its thread and the headers a reply refers to. */
async function readOriginal(client: GoogleClient, messageId: string): Promise<Original> {
  const message = parseReply(
    fullMessageSchema,
    await client.request(GMAIL_ROUTES.message, {
      params: { message_id: messageId },
      query: { format: "metadata", metadataHeaders: ORIGINAL_HEADERS },
    }),
    "the message replied to",
  )
  const messageIdHeader = headerOf(message.payload, "Message-ID")
  if (message.threadId === undefined || messageIdHeader === null || singleLine(messageIdHeader) === "") {
    throw new ToolError(
      "upstream_error",
      "The message replied to has no thread or no Message-ID header, so a reply cannot refer to it.",
    )
  }
  const references = headerOf(message.payload, "References")
  const subject = headerOf(message.payload, "Subject")
  return {
    threadId: message.threadId,
    messageIdHeader: singleLine(messageIdHeader),
    references: references === null ? null : singleLine(references),
    subject: subject === null ? null : singleLine(subject),
  }
}

/** The subject the mail goes with: the one given, else the original's with `Re: ` unless it has one. */
function subjectOf(given: string | undefined, original: Original | undefined): string {
  if (given !== undefined) return given
  const answered = original?.subject ?? ""
  return REPLY_PREFIX.test(answered) ? answered : `${REPLY_MARK}${answered}`
}

/** The files at `paths`, read whole and hashed; all of them together may hold at most `MAX_SEND_ATTACHMENT_MIB` MiB. */
async function readAttachments(paths: readonly string[], ctx: ToolContext): Promise<Upload[]> {
  const uploads: Upload[] = []
  let total = 0
  for (const path of paths) {
    if (ctx.signal?.aborted) throw abortError(ctx.signal)
    const upload = await readUpload(path, {
      uploadDirs: uploadDirsOf(ctx),
      stateDir: ctx.stateDir,
      ownDir: ctx.ownDir,
      maxBytes: MAX_SEND_ATTACHMENT_BYTES,
    })
    total += upload.size
    if (total > MAX_SEND_ATTACHMENT_BYTES) {
      throw new ToolError(
        "invalid_argument",
        `The attachments come to more than ${MAX_SEND_ATTACHMENT_MIB} MiB; at most ${MAX_SEND_ATTACHMENT_MIB} MiB may be sent in all.`,
      )
    }
    uploads.push(upload)
  }
  return uploads
}

/**
 * Reads and checks what a mail is made of, in this order: the arguments (the
 * recipients and the subject), the label's scopes (those of `route`, which
 * takes the mail, and the read route's for a reply), the mail replied to, the
 * attachments, and builds the mail. A send and a draft plan alike; `what` names
 * the work for a call with no runtime. Any failure here fails the call before
 * anything is written.
 */
export async function planMail(args: MailArgs, ctx: ToolContext, route: Route, what: string): Promise<MailPlan> {
  const recipients = recipientsOf(args)
  if (args.subject === undefined && args.reply_to === undefined) {
    throw new ToolError("invalid_argument", "A new mail needs a `subject`; only a reply may leave it out.")
  }
  const replyTo = args.reply_to === undefined ? undefined : gmailId(args.reply_to, "message id")
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, runtime, label } = await googleSession(ctx, args.account, what, GMAIL_TOOLSET)
  await client.requireScopes(route)
  if (replyTo !== undefined) await client.requireScopes(GMAIL_ROUTES.message)

  const original = replyTo === undefined ? undefined : await readOriginal(client, replyTo)
  const attachments = await readAttachments(args.attachments ?? [], ctx)
  const subject = subjectOf(args.subject, original)
  const mail = buildMime({
    to: args.to ?? [],
    cc: args.cc ?? [],
    bcc: args.bcc ?? [],
    subject,
    body: args.body,
    html: args.html ?? false,
    ...(original && {
      inReplyTo: original.messageIdHeader,
      references: [original.references, original.messageIdHeader].filter(Boolean).join(" "),
    }),
    attachments: attachments.map(({ name, bytes }) => ({ name, bytes })),
    now: runtime.now(),
  })
  return { client, label, recipients, subject, original, attachments, accountEmail: await client.accountEmail(), mail }
}
