import type { Route } from "../google/routes"
import { GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE } from "./scopes"

const GMAIL_HOST = "gmail.googleapis.com"

const MAILBOX_PATH = "/gmail/v1/users/me"

/** The scopes that read mail: the read one, and the one that also changes it. */
const READ_SCOPES = [GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE] as const

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
} as const satisfies Record<string, Route>
