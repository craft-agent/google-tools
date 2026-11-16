import { rm } from "node:fs/promises"
import { basename, extname, isAbsolute } from "node:path"
import { z } from "zod"
import { ToolError } from "../errors"
import { reserveDownload } from "../files/download"
import { UNKNOWN_MIME_TYPE } from "../files/mime-type"
import type { GoogleClient } from "../google/client"
import { MASK } from "../google/mask"
import type { ToolRuntime } from "../runtime"
import { parseReply } from "../sheets/reply"
import type { ToolContext } from "../tool"
import { fetchFullMessage } from "./message"
import { decodeData, findPart } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MIB, type AttachmentResult } from "./schemas"

/** The directory under the download directory that attachments are saved in. */
const ATTACHMENT_SUBDIR = "gmail-attachments"

/** The extension of a file whose own is missing or holds anything but letters and digits. */
const FALLBACK_EXTENSION = "bin"

const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,10}$/

/** How long Google may take to send an attachment of up to `MAX_ATTACHMENT_MIB`. */
const ATTACHMENT_TIMEOUT_MS = 120_000

const attachmentReply = z.object({ data: z.string().optional() })

function requireDownloadDir(ctx: ToolContext): string {
  const { downloadDir } = ctx
  if (!downloadDir || !isAbsolute(downloadDir)) {
    throw new ToolError("internal_error", "Gmail attachments require an absolute download directory.")
  }
  return downloadDir
}

/** The name and the extension an attachment is saved under: `name` or the file's own name without its extension, and the file's extension when it is plain. */
function savedName(filename: string, name: string | undefined): { stem: string; extension: string } {
  const own = extname(basename(filename))
  const extension = own.slice(1)
  return {
    stem: name ?? basename(filename, own),
    extension: EXTENSION_PATTERN.test(extension) ? extension.toLowerCase() : FALLBACK_EXTENSION,
  }
}

function tooLarge(size: number): ToolError {
  return new ToolError(
    "invalid_argument",
    `The attachment is ${size} bytes; attachment saves at most ${MAX_ATTACHMENT_MIB} MiB.`,
  )
}

/**
 * The attachment's bytes: what `attachments.get` returns for the part's
 * attachment id, which changes with every fetch and so is never given out,
 * else the part's own data when Gmail inlines it. The fetched `data` goes to a
 * file only, so the client masks it for the label's own secrets alone and
 * leaves it intact otherwise. The message's inline data is masked like the
 * rest of that reply, so inline data the masking changed is refused rather
 * than saved altered.
 */
async function attachmentBytes(
  client: GoogleClient,
  messageId: string,
  body: { data?: string; attachmentId?: string },
) {
  let data = body.data
  if (body.attachmentId === undefined && data?.includes(MASK)) {
    throw new ToolError(
      "upstream_error",
      "The attachment came inline in the message, where part of it reads like a credential and was masked, so it cannot be saved intact.",
    )
  }
  if (body.attachmentId !== undefined) {
    const reply = parseReply(
      attachmentReply,
      await client.request(GMAIL_ROUTES.attachment, {
        params: { message_id: messageId, attachment_id: body.attachmentId },
        saved: ["data"],
        timeoutMs: ATTACHMENT_TIMEOUT_MS,
      }),
      "an attachment",
    )
    data = reply.data
  }
  if (data === undefined) throw new ToolError("upstream_error", "Google gave no content for the attachment.")
  const content = decodeData(data)
  if (content.length > MAX_ATTACHMENT_BYTES) throw tooLarge(content.length)
  return content
}

/**
 * Saves one attachment of a message under the download directory
 * (`gmail-attachments`, a new file each call, mode 600) and returns where.
 * The part is the one `message` or `thread` lists; a part that is no
 * attachment is `not_found` and one over `MAX_ATTACHMENT_BYTES` is
 * `invalid_argument`, before its content is fetched. The file is removed when
 * writing it fails.
 */
export async function saveAttachment(
  client: GoogleClient,
  runtime: ToolRuntime,
  ctx: ToolContext,
  messageId: string,
  partId: string,
  name: string | undefined,
): Promise<AttachmentResult> {
  const downloadDir = requireDownloadDir(ctx)
  const message = await fetchFullMessage(client, messageId)
  const part = findPart(message.payload, partId)
  if (part === undefined || !part.filename) {
    throw new ToolError(
      "not_found",
      `Message ${messageId} has no attachment in part ${JSON.stringify(partId)}; \`message\` lists its attachments and their parts.`,
    )
  }
  const body = part.body ?? {}
  if (body.size !== undefined && body.size > MAX_ATTACHMENT_BYTES) throw tooLarge(body.size)
  const content = await attachmentBytes(client, message.id, body)

  const { path, handle } = await reserveDownload({
    downloadDir,
    stateDir: ctx.stateDir,
    ownDir: ctx.ownDir,
    subdir: ATTACHMENT_SUBDIR,
    ...savedName(part.filename, name),
    now: runtime.now(),
  })
  try {
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => {})
    throw error
  }
  return {
    message_id: message.id,
    part: partId,
    filename: part.filename,
    mime_type: part.mimeType ?? UNKNOWN_MIME_TYPE,
    size: content.length,
    path,
  }
}
