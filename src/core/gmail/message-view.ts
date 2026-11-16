import { maskText } from "../google/mask"
import { htmlToText } from "./html-text"
import { decodeData, headerOf, type FullMessage, type GmailPart } from "./payload"
import { UNKNOWN_MIME_TYPE, type AttachmentEntry, type MessageView } from "./schemas"

const PLAIN_TEXT = "text/plain"
const HTML = "text/html"

type Collected = { plain: string[]; html: string[]; attachments: AttachmentEntry[] }

/** `text` cut to `limit` characters (code points), and how many it keeps. */
function clipText(text: string, limit: number): { text: string; length: number; clipped: boolean } {
  if (text.length <= limit) return { text, length: Array.from(text).length, clipped: false }
  const characters = Array.from(text)
  if (characters.length <= limit) return { text, length: characters.length, clipped: false }
  return { text: characters.slice(0, limit).join(""), length: limit, clipped: true }
}

/** Gathers the text parts and the attachments of `part` and its children, in order; a part with a file name is an attachment, never text. */
function collect(part: GmailPart, into: Collected): void {
  const mimeType = (part.mimeType ?? "").toLowerCase()
  const data = part.body?.data
  if (part.filename) {
    if (part.partId !== undefined) {
      into.attachments.push({
        part: part.partId,
        filename: part.filename,
        mime_type: part.mimeType ?? UNKNOWN_MIME_TYPE,
        size: part.body?.size ?? 0,
      })
    }
  } else if (data && mimeType === PLAIN_TEXT) {
    into.plain.push(decodeData(data).toString("utf8"))
  } else if (data && mimeType === HTML) {
    into.html.push(decodeData(data).toString("utf8"))
  }
  for (const child of part.parts ?? []) collect(child, into)
}

/** The body of a message as text: its text parts, else its HTML parts turned into text. */
function bodyOf(collected: Collected): { text: string; body_format: MessageView["body_format"] } {
  if (collected.plain.length > 0) return { text: collected.plain.join("\n"), body_format: "text" }
  if (collected.html.length > 0) return { text: htmlToText(collected.html.join("\n")), body_format: "html_as_text" }
  return { text: "", body_format: "none" }
}

/**
 * The view of a message: its headers, its labels, its body as text (with
 * anything shaped like a Google credential masked) clipped to `bodyLimit`
 * characters and its attachments. `length` is how many characters
 * of body the view holds, for a caller that spends one budget across messages.
 * A `bodyLimit` of 0 leaves the body empty, `body_truncated` saying so when
 * there was one.
 */
export function messageView(message: FullMessage, bodyLimit: number): { view: MessageView; length: number } {
  const payload = message.payload
  const collected: Collected = { plain: [], html: [], attachments: [] }
  if (payload !== undefined) collect(payload, collected)
  const { text, body_format } = bodyOf(collected)
  const clipped = clipText(maskText(text), bodyLimit)
  return {
    length: clipped.length,
    view: {
      message_id: message.id,
      thread_id: message.threadId ?? "",
      from: headerOf(payload, "From"),
      to: headerOf(payload, "To"),
      cc: headerOf(payload, "Cc"),
      bcc: headerOf(payload, "Bcc"),
      reply_to: headerOf(payload, "Reply-To"),
      subject: headerOf(payload, "Subject"),
      date: headerOf(payload, "Date"),
      message_id_header: headerOf(payload, "Message-ID"),
      labels: message.labelIds ?? [],
      body: clipped.text,
      body_format,
      body_truncated: clipped.clipped,
      attachments: collected.attachments,
    },
  }
}
