/** The toolset of the Gmail tools. */
export const GMAIL_TOOLSET = "gmail"

/** Reads mail and its labels, never changes them. */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

/** Sends mail, and nothing else. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"

/** Creates, reads, updates and sends drafts, and sends mail. */
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose"

/** Reads and changes mail and its labels, trash included. */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
