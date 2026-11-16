import type { Route } from "../google/routes"
import { GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "./scopes"

const GMAIL_HOST = "gmail.googleapis.com"

const MAILBOX_PATH = "/gmail/v1/users/me"

/** The scopes that read mail: the read one, and the one that also changes it. */
const READ_SCOPES = [GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE] as const

/** The scopes that send mail: the send one, and the two that also compose or change it. */
const SEND_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE] as const

/** The scopes that read drafts: the read ones, and the compose one, which also reads the drafts it makes. */
const DRAFT_READ_SCOPES = [...READ_SCOPES, GMAIL_COMPOSE_SCOPE] as const

/** The scopes that change drafts and send one: the compose scope and the modify one; the send scope reaches no draft. */
const DRAFT_WRITE_SCOPES = [GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE] as const

/** The scopes that change labels and the trash: the modify scope alone; the compose and send scopes reach neither. */
const MODIFY_SCOPES = [GMAIL_MODIFY_SCOPE] as const

/** The calls the Gmail tools may make, each with every scope that allows it. */
export const GMAIL_ROUTES = {
  messages: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/messages`, scopes: READ_SCOPES },
  message: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/messages/{message_id}`, scopes: READ_SCOPES },
  thread: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/threads/{thread_id}`, scopes: READ_SCOPES },
  labels: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/labels`, scopes: READ_SCOPES },
  attachment: {
    method: "GET",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/messages/{message_id}/attachments/{attachment_id}`,
    scopes: READ_SCOPES,
  },
  /** The media upload form of `messages.send`, which takes the mail itself beside its thread (`uploadType=multipart`). */
  send: { method: "POST", host: GMAIL_HOST, path: `/upload${MAILBOX_PATH}/messages/send`, scopes: SEND_SCOPES },
  drafts: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/drafts`, scopes: DRAFT_READ_SCOPES },
  draft: { method: "GET", host: GMAIL_HOST, path: `${MAILBOX_PATH}/drafts/{draft_id}`, scopes: DRAFT_READ_SCOPES },
  /** The media upload form of `drafts.create`, which takes the mail itself beside its thread. */
  draftCreate: {
    method: "POST",
    host: GMAIL_HOST,
    path: `/upload${MAILBOX_PATH}/drafts`,
    scopes: DRAFT_WRITE_SCOPES,
  },
  /** The media upload form of `drafts.update`, which replaces the draft's whole message. */
  draftUpdate: {
    method: "PUT",
    host: GMAIL_HOST,
    path: `/upload${MAILBOX_PATH}/drafts/{draft_id}`,
    scopes: DRAFT_WRITE_SCOPES,
  },
  draftDelete: {
    method: "DELETE",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/drafts/{draft_id}`,
    scopes: DRAFT_WRITE_SCOPES,
  },
  draftSend: { method: "POST", host: GMAIL_HOST, path: `${MAILBOX_PATH}/drafts/send`, scopes: DRAFT_WRITE_SCOPES },
  labelCreate: { method: "POST", host: GMAIL_HOST, path: `${MAILBOX_PATH}/labels`, scopes: MODIFY_SCOPES },
  messagesBatchModify: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/messages/batchModify`,
    scopes: MODIFY_SCOPES,
  },
  threadModify: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/threads/{thread_id}/modify`,
    scopes: MODIFY_SCOPES,
  },
  messageTrash: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/messages/{message_id}/trash`,
    scopes: MODIFY_SCOPES,
  },
  messageUntrash: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/messages/{message_id}/untrash`,
    scopes: MODIFY_SCOPES,
  },
  threadTrash: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/threads/{thread_id}/trash`,
    scopes: MODIFY_SCOPES,
  },
  threadUntrash: {
    method: "POST",
    host: GMAIL_HOST,
    path: `${MAILBOX_PATH}/threads/{thread_id}/untrash`,
    scopes: MODIFY_SCOPES,
  },
} as const satisfies Record<string, Route>
