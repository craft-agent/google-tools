import { Buffer } from "node:buffer"
import { randomBytes } from "node:crypto"
import { ToolError } from "../errors"
import { htmlToText } from "./html-text"
import { fileType } from "../files/mime-type"

const CRLF = "\r\n"

/** The longest line a header is folded to where it can be, and the longest a base64 line holds. */
const FOLD_LENGTH = 76
const BASE64_LINE_LENGTH = 76

/** The most UTF-8 bytes of one encoded word of a subject: 45 bytes are 60 base64 characters, so the word is 72 characters with its frame. */
const ENCODED_WORD_BYTES = 45

/** The random bytes of a boundary. */
const BOUNDARY_BYTES = 12

const LINE_BREAK = /[\r\n]/
const ANY_LINE_ENDING = /\r\n|\r|\n/g
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
/** Printable ASCII but the quote and the backslash: what a quoted string holds as it is. */
const QUOTABLE_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/
/** What RFC 2231 leaves unencoded in a parameter value. */
const ATTRIBUTE_CHARACTER = /^[A-Za-z0-9!#$&+\-.^_`|~]$/

/** An attachment: the name it shows and its content. */
export type MimeAttachment = { name: string; bytes: Uint8Array }

export type MimeMessage = {
  to: readonly string[]
  cc: readonly string[]
  bcc: readonly string[]
  subject: string
  /** The text of the mail, or its HTML when `html` is true. */
  body: string
  html: boolean
  /** The `Message-ID` of the mail this one answers. */
  inReplyTo?: string
  /** The `References` of the mail this one answers, with its own id last. */
  references?: string
  attachments: readonly MimeAttachment[]
  /** The clock in epoch milliseconds, which the `Date` header carries. */
  now: number
}

function refuseLineBreak(what: string, value: string): void {
  if (LINE_BREAK.test(value)) {
    throw new ToolError("invalid_argument", `${what} must not hold a line break.`)
  }
}

/** Refuses an address that holds a line break or anything but printable ASCII, which a header could not carry as it is. */
function checkAddresses(name: string, addresses: readonly string[]): void {
  for (const address of addresses) {
    refuseLineBreak(`An address in ${name}`, address)
    if (!PRINTABLE_ASCII.test(address)) {
      throw new ToolError("invalid_argument", `An address in ${name} must be plain ASCII.`)
    }
  }
}

/** `line` folded at its spaces to `FOLD_LENGTH` characters where it can be: a word is never cut, and the space folded at stays at the start of the next line. */
function fold(line: string): string {
  const lines: string[] = []
  let current = ""
  line.split(" ").forEach((word, index) => {
    if (index === 0) {
      current = word
    } else if (word !== "" && current.length + 1 + word.length > FOLD_LENGTH) {
      lines.push(current)
      current = ` ${word}`
    } else {
      current += ` ${word}`
    }
  })
  return [...lines, current].join(CRLF)
}

/** `bytes` as base64 in lines of `BASE64_LINE_LENGTH`, with no line break at the end. */
function base64Lines(bytes: Uint8Array): string {
  const encoded = Buffer.from(bytes).toString("base64")
  const lines: string[] = []
  for (let at = 0; at < encoded.length; at += BASE64_LINE_LENGTH) lines.push(encoded.slice(at, at + BASE64_LINE_LENGTH))
  return lines.join(CRLF)
}

/** The RFC 2047 encoded words (UTF-8, base64) of `text`, none cut inside a character. */
function encodedWords(text: string): string[] {
  const words: string[] = []
  let chunk = ""
  for (const character of text) {
    if (chunk !== "" && Buffer.byteLength(chunk + character) > ENCODED_WORD_BYTES) {
      words.push(chunk)
      chunk = ""
    }
    chunk += character
  }
  if (chunk !== "") words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`)
}

/** The `Subject` header: the text as it is when plain ASCII, else as encoded words, one per folded line. */
function subjectHeader(subject: string): string {
  refuseLineBreak("The subject", subject)
  if (PRINTABLE_ASCII.test(subject) && !subject.includes("=?")) return fold(`Subject: ${subject}`)
  return `Subject: ${encodedWords(subject).join(`${CRLF} `)}`
}

/** An address header, folded between addresses; none when the list is empty. */
function addressHeader(name: string, addresses: readonly string[]): string[] {
  checkAddresses(name, addresses)
  return addresses.length === 0 ? [] : [fold(`${name}: ${addresses.join(", ")}`)]
}

/** A header that carries an id or a list of ids, folded; none when there is no value. */
function idHeader(name: string, value: string | undefined): string[] {
  if (value === undefined) return []
  refuseLineBreak(name, value)
  return [fold(`${name}: ${value}`)]
}

/** The `Date` header of the epoch milliseconds `now`, in UTC. */
function dateHeader(now: number): string {
  return `Date: ${new Date(now).toUTCString().replace("GMT", "+0000")}`
}

/** A text part of `subtype` holding `text` with CRLF line breaks, as base64. */
function textPart(subtype: "plain" | "html", text: string): string {
  const content = Buffer.from(text.replace(ANY_LINE_ENDING, CRLF))
  return [
    `Content-Type: text/${subtype}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(content),
  ].join(CRLF)
}

function holds(part: string | Uint8Array, text: string): boolean {
  if (typeof part === "string") return part.includes(text)
  return Buffer.from(part.buffer, part.byteOffset, part.byteLength).includes(text)
}

/** A random boundary that none of `parts` holds, so no part can end the multipart early. */
export function boundaryAmong(parts: readonly (string | Uint8Array)[]): string {
  for (;;) {
    const boundary = `=_${randomBytes(BOUNDARY_BYTES).toString("hex")}`
    if (!parts.some((part) => holds(part, boundary))) return boundary
  }
}

/** The `multipart/<subtype>` part that holds `parts`. */
function multipart(subtype: "alternative" | "mixed", parts: readonly string[]): string {
  const boundary = boundaryAmong(parts)
  const body = parts.map((part) => `--${boundary}${CRLF}${part}${CRLF}`).join("")
  return [`Content-Type: multipart/${subtype}; boundary="${boundary}"`, "", `${body}--${boundary}--${CRLF}`].join(CRLF)
}

/** `name` percent-encoded as RFC 2231 has it: every byte of its UTF-8 except the ASCII `ATTRIBUTE_CHARACTER`s. */
function extendedValue(name: string): string {
  return Array.from(Buffer.from(name), (byte) => {
    const character = String.fromCharCode(byte)
    return ATTRIBUTE_CHARACTER.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  }).join("")
}

/** The `Content-Disposition` header of an attachment: the name as a quoted string when plain, else with an ASCII stand-in and the exact name as `filename*`. */
function dispositionHeader(name: string): string {
  if (QUOTABLE_ASCII.test(name)) return fold(`Content-Disposition: attachment; filename="${name}"`)
  const standIn = Array.from(name, (character) => (QUOTABLE_ASCII.test(character) ? character : "_")).join("")
  return fold(`Content-Disposition: attachment; filename="${standIn}"; filename*=UTF-8''${extendedValue(name)}`)
}

function attachmentPart({ name, bytes }: MimeAttachment): string {
  return [
    `Content-Type: ${fileType(name)}`,
    dispositionHeader(name),
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(bytes),
  ].join(CRLF)
}

/** The part that holds the text of the mail: its text alone, or its text beside its HTML. */
function contentPart({ body, html }: Pick<MimeMessage, "body" | "html">): string {
  if (!html) return textPart("plain", body)
  return multipart("alternative", [textPart("plain", htmlToText(body)), textPart("html", body)])
}

/**
 * The mail as RFC 5322 bytes with CRLF line endings, ready for `messages.send`.
 * `From` is left out for Gmail to fill and so is `Message-ID`. The body is
 * `text/plain`, or `multipart/alternative` (the HTML turned into text, then the
 * HTML) when `html` is true; attachments wrap it in `multipart/mixed`. Every
 * text is base64, a non-ASCII subject is encoded words and a name that is not
 * plain ASCII is also given as `filename*`. A line break in the subject, an
 * address or an id, and an address that is not plain ASCII, are
 * `invalid_argument`.
 */
export function buildMime(message: MimeMessage): Uint8Array {
  const content = contentPart(message)
  const top =
    message.attachments.length === 0
      ? content
      : multipart("mixed", [content, ...message.attachments.map(attachmentPart)])
  const headers = [
    ...addressHeader("To", message.to),
    ...addressHeader("Cc", message.cc),
    ...addressHeader("Bcc", message.bcc),
    subjectHeader(message.subject),
    dateHeader(message.now),
    ...idHeader("In-Reply-To", message.inReplyTo),
    ...idHeader("References", message.references),
    "MIME-Version: 1.0",
  ]
  return Buffer.from([...headers, top].join(CRLF))
}
