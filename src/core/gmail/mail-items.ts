import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { parseReply } from "../sheets/reply"
import type { CallText } from "../tool"
import { fetchInBatches } from "./fetch-batches"
import { gmailId } from "./ids"
import { headerOf, partSchema, type GmailPart } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { singleLine } from "./send-plan"
import { GMAIL_WORDS } from "./words"

/** Whether a call works on single messages or on whole threads. */
export type MailKind = "messages" | "threads"

/** The messages or threads a call names, by id, each once in the order given. */
export type MailSelection = { kind: MailKind; ids: string[] }

/** What a kind of mail is called in an error, the path parameter of its routes and the routes themselves. */
const KINDS = {
  messages: {
    what: "message id",
    param: "message_id",
    get: GMAIL_ROUTES.message,
    trash: GMAIL_ROUTES.messageTrash,
    untrash: GMAIL_ROUTES.messageUntrash,
  },
  threads: {
    what: "thread id",
    param: "thread_id",
    get: GMAIL_ROUTES.thread,
    trash: GMAIL_ROUTES.threadTrash,
    untrash: GMAIL_ROUTES.threadUntrash,
  },
} as const satisfies Record<MailKind, { what: string; param: string; get: Route; trash: Route; untrash: Route }>

/** The headers a mail's line in a prompt is made of. */
const LINE_HEADERS = ["Date", "From", "Subject"]

/** What `messages.get` and `threads.get` answer in the `metadata` format: a message's own headers, or the messages of a thread. */
const itemReply = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  payload: partSchema.optional(),
  messages: z.array(z.object({ payload: partSchema.optional() })).optional(),
})

/** A message or thread as the prompt shows it. */
export type MailItem = {
  id: string
  /** Gmail's history id of the item, which changes whenever the mail does; empty when Google gives none. */
  historyId: string
  /** `<date> <from> — <subject>` as one line. */
  line: string
}

/** The mail the arguments name: exactly one of `messages` and `threads`, each id one Gmail could have written. */
export function selectMail(args: { messages?: readonly string[]; threads?: readonly string[] }): MailSelection {
  const { messages, threads } = args
  if ((messages === undefined) === (threads === undefined)) {
    throw new ToolError("invalid_argument", "Give exactly one of `messages` and `threads`.")
  }
  const kind: MailKind = messages === undefined ? "threads" : "messages"
  const ids = (messages ?? threads)!.map((id) => gmailId(id, KINDS[kind].what))
  return { kind, ids: [...new Set(ids)] }
}

/** The route that reads one message or thread, that trashes one and that moves one out of the trash, and the name of its id's path parameter. */
export function mailRoutes(kind: MailKind) {
  return KINDS[kind]
}

/** The line a prompt shows for a mail whose first message has the headers of `part`: date and sender, a dash, and the subject. */
function lineOf(part: GmailPart | undefined): string {
  const header = (name: string) => singleLine(headerOf(part, name) ?? "")
  const head = [header("Date"), header("From")].filter((text) => text !== "").join(" ")
  const subject = header("Subject") || GMAIL_WORDS.noSubject
  return head === "" ? subject : `${head} — ${subject}`
}

/** The message or thread `id`, read from its headers alone. */
async function readItem(client: GoogleClient, kind: MailKind, id: string): Promise<MailItem> {
  const { get, param, what } = KINDS[kind]
  const reply = parseReply(
    itemReply,
    await client
      .request(get, {
        params: { [param]: id },
        query: { format: "metadata", metadataHeaders: LINE_HEADERS },
      })
      .catch((error: unknown) => {
        if (error instanceof ToolError && error.code === "not_found") {
          throw new ToolError("not_found", `The ${what} "${id}" was not found. ${error.message}`, {
            cause: error,
            details: error.details,
          })
        }
        throw error
      }),
    "a message or thread",
  )
  return { id, historyId: reply.historyId ?? "", line: lineOf(reply.payload ?? reply.messages?.[0]?.payload) }
}

/** The items `ids` name, read five at a time, in the order of `ids`; one that is gone is `not_found`. */
export function readItems(client: GoogleClient, kind: MailKind, ids: readonly string[]): Promise<MailItem[]> {
  return fetchInBatches(ids, (id) => readItem(client, kind, id))
}

/** The `Mail` text of a prompt: one line per item, then how many of the `total` are not shown. */
export function mailText(items: readonly MailItem[], total: number): CallText {
  const lines = items.map(({ line }) => line)
  if (total > items.length) lines.push(`+${total - items.length} more`)
  return { label: GMAIL_WORDS.mail, body: lines.join("\n") }
}

/** One digest of every item's id and history id: a prompt keeps few pins, and a call may name a hundred items. */
export function itemsDigest(items: readonly MailItem[]): string {
  return createHash("sha256")
    .update(items.map(({ id, historyId }) => `${id}:${historyId}`).join("\n"))
    .digest("hex")
}
