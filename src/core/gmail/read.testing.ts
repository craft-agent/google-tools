import { Buffer } from "node:buffer"
import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { fixture as sheetsFixture } from "../sheets/read.testing"
import { invoke } from "../tool"
import { googleGmailRead } from "./read"
import { GMAIL_READ_SCOPE } from "./scopes"

/** Fixtures the Gmail read tests share: the state directory, download directory and fake Google of the Sheets fixtures, with a label logged in for Gmail and the Gmail read as the tool. */

export { answer, callOf, cleanUp, freshTokens } from "../sheets/read.testing"

/** What a label logged in for the gmail toolset, read only, holds. */
export const GMAIL_CREDENTIAL: Credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, GMAIL_READ_SCOPE] }

export const MAILBOX_URL = "https://gmail.googleapis.com/gmail/v1/users/me"
export const MESSAGES_URL = `${MAILBOX_URL}/messages`
export const LABELS_URL = `${MAILBOX_URL}/labels`

/** Made-up Gmail ids, as Gmail writes them. */
export const MESSAGE_ID = "18f3a2b4c5d6e7f0"
export const THREAD_ID = "18f3a2b4c5d6e7a1"

export const messageUrl = (id: string) => `${MESSAGES_URL}/${id}`
export const threadUrl = (id: string) => `${MAILBOX_URL}/threads/${id}`
export const attachmentUrl = (messageId: string, attachmentId: string) =>
  `${MESSAGES_URL}/${messageId}/attachments/${attachmentId}`

/** `text` as Gmail encodes a part's content: base64url without padding. */
export const encoded = (text: string | Uint8Array) => Buffer.from(text).toString("base64url")

/** A part with the headers it carries, the way Gmail writes them. */
export const headersOf = (headers: Record<string, string>) =>
  Object.entries(headers).map(([name, value]) => ({ name, value }))

/** A text part holding `text`. */
export const textPart = (mimeType: string, text: string, partId = "0") => ({
  partId,
  mimeType,
  filename: "",
  body: { size: text.length, data: encoded(text) },
})

/** A part that is a file: its content inline (`data`) or fetched later (`attachmentId`). */
export const filePart = (
  partId: string,
  filename: string,
  body: { size: number; data?: string; attachmentId?: string },
  mimeType = "application/pdf",
) => ({ partId, mimeType, filename, body })

/** A message as `messages.get` gives it in the `full` format. */
export function fullMessage(
  id: string,
  parts: unknown[],
  headers: Record<string, string> = { Subject: "Lunch", From: "Ann <ann@example.test>" },
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    threadId: THREAD_ID,
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Are we still on",
    payload: { partId: "", mimeType: "multipart/mixed", headers: headersOf(headers), body: { size: 0 }, parts },
    ...extra,
  }
}

/** The fixtures with a label logged in for Gmail, and `read` calling the Gmail read. */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = GMAIL_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const h = await sheetsFixture(handlers, credential, env)
  return { ...h, read: (args: unknown) => invoke(googleGmailRead, args, h.ctx) }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>
