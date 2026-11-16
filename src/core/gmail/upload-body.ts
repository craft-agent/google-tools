import { Buffer } from "node:buffer"
import { boundaryAmong } from "./mime"

const CRLF = "\r\n"

/** How long Google may take to take in a mail with the most attachments a mail may carry, as a send or as a draft. */
export const UPLOAD_TIMEOUT_MS = 120_000

/**
 * The body of Gmail's `uploadType=multipart` call: a `multipart/related` of a
 * JSON part (`metadata`) and the mail itself as a `message/rfc822` part, with
 * the `Content-Type` that names its boundary.
 */
export function relatedUpload(metadata: object, mail: Uint8Array): { type: string; bytes: Uint8Array } {
  const json = JSON.stringify(metadata)
  const boundary = boundaryAmong([json, mail])
  const bytes = Buffer.concat([
    Buffer.from(`--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${json}${CRLF}`),
    Buffer.from(`--${boundary}${CRLF}Content-Type: message/rfc822${CRLF}${CRLF}`),
    mail,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ])
  return { type: `multipart/related; boundary="${boundary}"`, bytes }
}
