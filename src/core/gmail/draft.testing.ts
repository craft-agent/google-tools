import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { MAILBOX_URL, THREAD_ID, answer, headersOf, textPart } from "./read.testing"
import { GMAIL_COMPOSE_SCOPE } from "./scopes"
import { REPLY_CREDENTIAL } from "./send.testing"

/** Fixtures the Gmail draft tests share: a label that may compose, and the drafts and the replies of Google about them. */

export { callOf, cleanUp, freshTokens, removeUploads } from "./send.testing"

/** A label that may compose and read, and so write and read drafts and mail; its address is `someone@example.test`. */
export const DRAFT_CREDENTIAL: Credential = {
  ...REPLY_CREDENTIAL,
  scopes: [...REPLY_CREDENTIAL.scopes.filter((scope) => !scope.endsWith("gmail.send")), GMAIL_COMPOSE_SCOPE],
}

/** Made-up Gmail ids of a draft and of its message. */
export const DRAFT_ID = "r-9182736450182736"
export const DRAFT_MESSAGE_ID = "18f3a2b4c5d6e800"

export const DRAFTS_URL = `${MAILBOX_URL}/drafts`
export const draftUrl = (id: string) => `${DRAFTS_URL}/${id}`
export const DRAFT_SEND_URL = `${DRAFTS_URL}/send`
export const UPLOAD_DRAFTS_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts"

/** What `drafts.create` and `drafts.update` answer. */
export const WRITTEN = { id: DRAFT_ID, message: { id: "18f3a2b4c5d6e801", threadId: THREAD_ID } }

/** The headers of the draft the tests hold. */
export const DRAFT_HEADERS = {
  To: "Ann <ann@example.test>",
  Subject: "Lunch plans",
  Date: "Mon, 1 Jun 2026 09:00:00 +0000",
}

/** A draft as `drafts.get` gives it with `format=metadata`. */
export function draftMetadata(
  headers: Record<string, string> = DRAFT_HEADERS,
  messageId = DRAFT_MESSAGE_ID,
  id = DRAFT_ID,
) {
  return {
    id,
    message: {
      id: messageId,
      threadId: THREAD_ID,
      snippet: "Are we still on",
      payload: { headers: headersOf(headers) },
    },
  }
}

/** A draft as `drafts.get` gives it with `format=full`: its headers, a text part and the `parts` beside it. */
export function draftFull(
  headers: Record<string, string> = DRAFT_HEADERS,
  text = "Are we still on for lunch?",
  parts: unknown[] = [],
  extra: Record<string, unknown> = { sizeEstimate: 1536 },
) {
  const draft = draftMetadata(headers)
  return {
    ...draft,
    message: {
      ...draft.message,
      ...extra,
      payload: {
        partId: "",
        mimeType: "multipart/mixed",
        headers: headersOf(headers),
        body: { size: 0 },
        parts: [textPart("text/plain", text, "0"), ...parts],
      },
    },
  }
}

/** The handler that answers the draft with `reply` (`DRAFT_ID` unless `id` is given). */
export const draftHandler = (reply: unknown, id = DRAFT_ID): FakeHandler => answer(draftUrl(id), reply)

/** The handlers of a draft that a write may replace: it takes the update and answers it. */
export const updateHandler: FakeHandler = {
  method: "PUT",
  url: `${UPLOAD_DRAFTS_URL}/${DRAFT_ID}`,
  reply: { json: WRITTEN },
}
export const createHandler: FakeHandler = { method: "POST", url: UPLOAD_DRAFTS_URL, reply: { json: WRITTEN } }
export const deleteHandler: FakeHandler = { method: "DELETE", url: draftUrl(DRAFT_ID), reply: { status: 204 } }
export const draftSendHandler: FakeHandler = {
  method: "POST",
  url: DRAFT_SEND_URL,
  reply: { json: { id: "18f3a2b4c5d6e7ff", threadId: THREAD_ID, labelIds: ["SENT"] } },
}
