import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { bound } from "./draft.fixture.testing"
import { googleGmailLabel } from "./label"
import { googleGmailLabelCreate } from "./label-create"
import { LABELS_URL, MAILBOX_URL, MESSAGES_URL, THREAD_ID, answer, fixture, headersOf } from "./read.testing"
import { GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE } from "./scopes"
import { googleGmailTrash } from "./trash"

/** Fixtures the label, label creation and trash tests share: a label that may modify mail, the labels and mail of the mailbox, and the three tools bound to them. */

export { callOf, cleanUp, freshTokens } from "./read.testing"

/** A label that may read and modify mail, labels and the trash. */
export const MODIFY_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE],
}

/** The labels the mailbox of the tests holds: system ones and the account's own. */
export const MAILBOX_LABELS = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "TRASH", name: "TRASH", type: "system" },
  { id: "STARRED", name: "STARRED", type: "system" },
  { id: "Label_1", name: "Receipts", type: "user" },
  { id: "Label_2", name: "Work/Invoices", type: "user" },
]

/** The handler that lists `labels`. */
export const labelsHandler = (labels: unknown[] = MAILBOX_LABELS): FakeHandler => answer(LABELS_URL, { labels })

export const BATCH_MODIFY_URL = `${MESSAGES_URL}/batchModify`
export const messageActionUrl = (id: string, action: string) => `${MESSAGES_URL}/${id}/${action}`
export const threadActionUrl = (id: string, action: string) => `${MAILBOX_URL}/threads/${id}/${action}`

/** The handler that takes a POST to `url` and answers `reply`. */
export const postHandler = (url: string | RegExp, reply: unknown = {}): FakeHandler => ({
  method: "POST",
  url,
  reply: { json: reply },
})

const HEADERS = { Date: "Mon, 1 Jun 2026 09:00:00 +0000", From: "Ann <ann@example.test>" }

/** The handler that answers the metadata of any message, by its id: its headers and a history id of `history(id)`. */
export function messagesMetadata(history: (id: string) => string = (id) => `${id}-h1`): FakeHandler {
  return {
    method: "GET",
    url: /\/users\/me\/messages\/[^/?]+\?/,
    reply: (request) => {
      const id = request.url.pathname.split("/").pop()!
      return {
        json: {
          id,
          threadId: THREAD_ID,
          historyId: history(id),
          payload: { headers: headersOf({ ...HEADERS, Subject: `Mail ${id}` }) },
        },
      }
    },
  }
}

/** The handler that answers the metadata of any thread, by its id: its first message's headers and a history id of `history(id)`. */
export function threadsMetadata(history: (id: string) => string = (id) => `${id}-h1`): FakeHandler {
  return {
    method: "GET",
    url: /\/users\/me\/threads\/[^/?]+\?/,
    reply: (request) => {
      const id = request.url.pathname.split("/").pop()!
      return {
        json: {
          id,
          historyId: history(id),
          messages: [{ id: `${id}-m1`, payload: { headers: headersOf({ ...HEADERS, Subject: `Thread ${id}` }) } }],
        },
      }
    },
  }
}

/** `count` made-up ids with `prefix`, such as `m001`. */
export const idsOf = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(3, "0")}`)

/** The fixtures with `credential` (a label that may modify unless given, `null` for none) and the label, label creation and trash tools bound to them. */
export async function mailboxFixture(
  options: { handlers?: FakeHandler[]; credential?: Credential | null; env?: Record<string, string> } = {},
) {
  const h = await fixture(
    options.handlers ?? [],
    options.credential === undefined ? MODIFY_CREDENTIAL : options.credential,
    options.env,
  )
  return {
    ...h,
    label: bound(googleGmailLabel, h.ctx),
    create: bound(googleGmailLabelCreate, h.ctx),
    trash: bound(googleGmailTrash, h.ctx),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
  }
}
