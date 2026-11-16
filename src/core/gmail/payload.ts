import { Buffer } from "node:buffer"
import { z } from "zod"

/** One part of a message as Gmail's `full` format gives it. */
export type GmailPart = {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: { name?: string; value?: string }[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}

export const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string().optional(), value: z.string().optional() })).optional(),
    body: z
      .object({ size: z.number().optional(), data: z.string().optional(), attachmentId: z.string().optional() })
      .optional(),
    parts: z.array(partSchema).optional(),
  }),
)

/** A message as `messages.get` gives it, in the `full` format. */
export const fullMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  /** Google's estimate of the message's size in bytes. */
  sizeEstimate: z.number().optional(),
  payload: partSchema.optional(),
})

export type FullMessage = z.output<typeof fullMessageSchema>

/** The value of the first header named `name` (any case) of `part`, or `null`. */
export function headerOf(part: GmailPart | undefined, name: string): string | null {
  const wanted = name.toLowerCase()
  const found = part?.headers?.find((header) => header.name?.toLowerCase() === wanted)
  return found?.value ?? null
}

/** The bytes of base64url `data`, as Gmail encodes a part's content; the padding may be missing. */
export function decodeData(data: string): Buffer {
  return Buffer.from(data, "base64url")
}

/** The part of `payload` (or `payload` itself) whose id is `partId`, or `undefined`. */
export function findPart(payload: GmailPart | undefined, partId: string): GmailPart | undefined {
  if (payload === undefined) return undefined
  if (payload.partId === partId) return payload
  for (const child of payload.parts ?? []) {
    const found = findPart(child, partId)
    if (found !== undefined) return found
  }
  return undefined
}
