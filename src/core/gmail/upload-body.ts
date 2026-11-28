import { Buffer } from "node:buffer"
import { boundaryAmong } from "./mime"

const CRLF = "\r\n"

/** How long Google may take to take in a mail with the most attachments a mail may carry, as a send or as a draft. */
export const UPLOAD_TIMEOUT_MS = 120_000

/** The media type of a mail, which Gmail's uploads carry. */
const MAIL_TYPE = "message/rfc822"

/**
 * The body of an `uploadType=multipart` call: a `multipart/related` of a JSON
 * part (`metadata`) and the content itself as a part of `mediaType` (a mail,
 * Gmail's own, unless given), with the `Content-Type` that names its boundary.
 */
export function relatedUpload(
  metadata: object,
  media: Uint8Array,
  mediaType = MAIL_TYPE,
): { type: string; bytes: Uint8Array } {
  const json = JSON.stringify(metadata)
  const boundary = boundaryAmong([json, media])
  const bytes = Buffer.concat([
    Buffer.from(`--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${json}${CRLF}`),
    Buffer.from(`--${boundary}${CRLF}Content-Type: ${mediaType}${CRLF}${CRLF}`),
    media,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ])
  return { type: `multipart/related; boundary="${boundary}"`, bytes }
}
