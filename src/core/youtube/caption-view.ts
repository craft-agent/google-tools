import { z } from "zod"

/** A caption track as `captions.list` gives it with the part `snippet`; every field not read here is left out of the parse. */
const captionReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      language: z.string().optional(),
      name: z.string().optional(),
      trackKind: z.string().optional(),
      isDraft: z.boolean().optional(),
      status: z.string().optional(),
      lastUpdated: z.string().optional(),
    })
    .optional(),
})

export const captionsList = z.object({ items: z.array(captionReply).optional() })

export const captionSchema = z.object({
  caption_id: z.string(),
  language: z.string().nullable(),
  name: z.string().nullable(),
  /** `standard`, `asr` (YouTube's automatic track) or `forced`. */
  kind: z.string().nullable(),
  draft: z.boolean().nullable(),
  /** `serving`, `syncing` or `failed`. */
  status: z.string().nullable(),
  updated_at: z.string().nullable(),
})

export type CaptionView = z.output<typeof captionSchema>

/** What the read returns of a caption track. */
export function captionView(caption: z.output<typeof captionReply>): CaptionView {
  const { snippet } = caption
  return {
    caption_id: caption.id,
    language: snippet?.language ?? null,
    name: snippet?.name ?? null,
    kind: snippet?.trackKind ?? null,
    draft: snippet?.isDraft ?? null,
    status: snippet?.status ?? null,
    updated_at: snippet?.lastUpdated ?? null,
  }
}
