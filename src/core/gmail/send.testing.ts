import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeRequest } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke } from "../tool"
import { MESSAGE_ID, THREAD_ID, answer, fixture, headersOf, messageUrl } from "./read.testing"
import { parseMime, type ParsedPart } from "./mime.testing"
import { googleGmailSend } from "./send"
import { GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "./scopes"

/** Fixtures the Gmail send tests share: the Gmail read fixtures with a label that may send, an upload directory the setting names and the tool. */

export { callOf, cleanUp, freshTokens } from "./read.testing"

/** What a label logged in for the gmail toolset, send only, holds; its address is `someone@example.test`. */
export const SEND_CREDENTIAL: Credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, GMAIL_SEND_SCOPE] }

/** A label that may send and read, which a reply needs. */
export const REPLY_CREDENTIAL: Credential = {
  ...SEND_CREDENTIAL,
  scopes: [...SEND_CREDENTIAL.scopes, GMAIL_READ_SCOPE],
}

export const SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send"

/** What `messages.send` answers. */
export const SENT = { id: "18f3a2b4c5d6e7ff", threadId: "18f3a2b4c5d6e7a2", labelIds: ["SENT"] }

/** The handler that takes the mail in. */
export const sendHandler: FakeHandler = { method: "POST", url: SEND_URL, reply: { json: SENT } }

/** The `Message-ID` of the mail the reply tests answer. */
export const ORIGINAL_ID = "<original-1@example.test>"

/** The metadata of the mail the reply tests answer, as `messages.get` gives it with `format=metadata`. */
export function originalMessage(headers: Record<string, string> = {}) {
  return {
    id: MESSAGE_ID,
    threadId: THREAD_ID,
    payload: {
      headers: headersOf({
        "Message-ID": ORIGINAL_ID,
        References: "<root@example.test>",
        Subject: "Lunch",
        ...headers,
      }),
    },
  }
}

export const originalHandler = (headers: Record<string, string> = {}) =>
  answer(messageUrl(MESSAGE_ID), originalMessage(headers))

const made: string[] = []

/** Removes the upload directories the fixtures made. */
export async function removeUploads(): Promise<void> {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
}

/**
 * The Gmail fixtures with `credential` (a label that may send and read unless
 * given, `null` for none), an upload directory holding `files`
 * (name to content) that the `upload_dirs` setting names unless `uploadDirs`
 * says otherwise, and the send tool.
 */
export async function sendFixture(
  options: {
    handlers?: FakeHandler[]
    credential?: Credential | null
    files?: Record<string, string | Uint8Array>
    uploadDirs?: (uploadDir: string, stateDir: string) => string[]
  } = {},
) {
  const h = await fixture(
    options.handlers ?? [sendHandler],
    options.credential === undefined ? REPLY_CREDENTIAL : options.credential,
  )
  const uploadDir = join(await realpath(await mkdtemp(join(tmpdir(), "gmail-send-"))), "outbox")
  made.push(uploadDir)
  await mkdir(uploadDir)
  for (const [name, content] of Object.entries(options.files ?? {})) await writeFile(join(uploadDir, name), content)
  const ctx = { ...h.ctx, options: { upload_dirs: options.uploadDirs?.(uploadDir, h.stateDir) ?? [uploadDir] } }
  return {
    ...h,
    ctx,
    uploadDir,
    send: (args: unknown) => invoke(googleGmailSend, args, ctx),
    describe: async (args: unknown) => googleGmailSend.describe!(googleGmailSend.input.parse(args), ctx),
    targets: (args: unknown) => writeTargets(googleGmailSend, args, ctx),
    /** The requests that went to the send route. */
    sends: () => h.calls().filter((request) => request.url.pathname.endsWith("/messages/send")),
  }
}

/** The mail a send request carried: the JSON of its first part and the parsed mail of its second. */
export function sentMail(request: FakeRequest): { metadata: unknown; mail: ParsedPart; type: string } {
  const type = request.headers["content-type"] ?? ""
  const boundary = /boundary="([^"]+)"/.exec(type)![1]!
  const text = Buffer.from(request.bytes!).toString("latin1")
  const [, first, second] = text.split(`--${boundary}`)
  const [jsonHeaders, json] = first!.replace(/^\r\n/, "").split("\r\n\r\n")
  const [mailHeaders, ...mail] = second!.replace(/^\r\n/, "").split("\r\n\r\n")
  if (!jsonHeaders!.includes("application/json") || !mailHeaders!.includes("message/rfc822")) {
    throw new Error("the send request is not a JSON part and a message/rfc822 part")
  }
  return {
    type,
    metadata: JSON.parse(json!.replace(/\r\n$/, "")),
    mail: parseMime(mail.join("\r\n\r\n").replace(/\r\n$/, "")),
  }
}
