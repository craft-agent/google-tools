import { Buffer } from "node:buffer"
import type { MimeMessage } from "./mime"

/** A small MIME reader for the tests: enough to check the structure `buildMime` writes, nothing a mail client needs. */

export type ParsedPart = {
  /** Header names in lower case, folded lines unfolded. */
  headers: Record<string, string>
  /** The raw header block, folding included. */
  rawHeaders: string
  /** The type without its parameters, in lower case. */
  type: string
  /** The decoded content of a base64 part. */
  content?: Buffer
  parts?: ParsedPart[]
  /** The part exactly as it was written, header block and body. */
  raw: string
}

/** The mail the tests send unless they change a field. */
export const MESSAGE: MimeMessage = {
  to: ["ann@example.test"],
  cc: [],
  bcc: [],
  subject: "Lunch",
  body: "Are we still on?",
  html: false,
  attachments: [],
  now: Date.UTC(2026, 10, 16, 9, 8, 7),
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of block.replace(/\r\n[ \t]/g, " ").split("\r\n")) {
    const colon = line.indexOf(":")
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }
  return headers
}

/** The part `text` holds, its multipart children and its base64 content decoded. */
export function parseMime(text: string): ParsedPart {
  const split = text.indexOf("\r\n\r\n")
  const rawHeaders = text.slice(0, split)
  const body = text.slice(split + 4)
  const headers = parseHeaders(rawHeaders)
  const contentType = headers["content-type"] ?? "text/plain"
  const type = contentType.split(";")[0]!.trim().toLowerCase()
  const part: ParsedPart = { headers, rawHeaders, type, raw: text }
  const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1]
  if (boundary !== undefined) {
    const chunks = body.split(`\r\n--${boundary}`)
    const children = [
      chunks[0]!.slice(`--${boundary}\r\n`.length),
      ...chunks.slice(1, -1).map((chunk) => chunk.slice(2)),
    ]
    part.parts = children.map(parseMime)
  } else if (headers["content-transfer-encoding"] === "base64") {
    part.content = Buffer.from(body, "base64")
  }
  return part
}

/** The first part of `type` among `part` and its descendants. */
export function findType(part: ParsedPart, type: string): ParsedPart | undefined {
  if (part.type === type) return part
  for (const child of part.parts ?? []) {
    const found = findType(child, type)
    if (found !== undefined) return found
  }
  return undefined
}
