import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import { canonicalJson } from "../pin"

/** The parts of a video the writes read and send: `videos.update` takes each whole. */
export const VIDEO_STATE_PARTS = "snippet,status,localizations"

/** A localization as Google gives it: a title and a description in one language. */
export const localizationReply = z.object({ title: z.string().optional(), description: z.string().optional() })

/**
 * A video as `videos.list` and `videos.update` give it with the parts
 * `snippet`, `status` and `localizations`. Only the writable properties are
 * kept (and the snippet's `channelId`, which says whose the video is), since
 * an update sends back exactly those; every other field is left out of the
 * parse.
 */
export const videoStateReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      channelId: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      categoryId: z.string().optional(),
      defaultLanguage: z.string().optional(),
      defaultAudioLanguage: z.string().optional(),
    })
    .optional(),
  status: z
    .object({
      privacyStatus: z.string().optional(),
      publishAt: z.string().optional(),
      embeddable: z.boolean().optional(),
      license: z.string().optional(),
      publicStatsViewable: z.boolean().optional(),
      selfDeclaredMadeForKids: z.boolean().optional(),
      containsSyntheticMedia: z.boolean().optional(),
    })
    .optional(),
  localizations: z.record(z.string(), localizationReply).optional(),
})

export const videosStateList = z.object({ items: z.array(videoStateReply).optional() })

export type VideoStateReply = z.output<typeof videoStateReply>

/** The writable properties of a video's `snippet`. */
export type VideoSnippet = {
  title: string
  description: string
  tags: string[]
  categoryId?: string
  defaultLanguage?: string
  defaultAudioLanguage?: string
}

/** The writable properties of a video's `status`. */
export type VideoStatus = {
  privacyStatus: string
  publishAt?: string
  embeddable?: boolean
  license?: string
  publicStatsViewable?: boolean
  selfDeclaredMadeForKids?: boolean
  containsSyntheticMedia?: boolean
}

/** A video's title and description in one language. */
export type Localization = { title?: string; description?: string }

/** A video as the writes work with it: the writable properties an update sends back, as Google gave them. */
export type VideoState = {
  id: string
  snippet: VideoSnippet
  status: VideoStatus
  localizations: Record<string, Localization>
}

/** The video `reply` holds as a state; one without a title or a privacy is not the shape the writes rely on, `upstream_error`. */
export function videoState(reply: VideoStateReply): VideoState {
  const { snippet, status } = reply
  if (snippet?.title === undefined || status?.privacyStatus === undefined) {
    throw new ToolError("upstream_error", "Google's reply to the video list was not in the expected shape.")
  }
  const { channelId: _channelId, ...writable } = snippet
  return {
    id: reply.id,
    snippet: { ...writable, title: snippet.title, description: snippet.description ?? "", tags: snippet.tags ?? [] },
    status: { ...status, privacyStatus: status.privacyStatus },
    localizations: reply.localizations ?? {},
  }
}

/** `state` with what Google's update `reply` reports laid over it: a part or a property the reply leaves out keeps its value. */
export function withReply(state: VideoState, reply: VideoStateReply): VideoState {
  const { channelId: _channelId, ...snippet } = reply.snippet ?? {}
  return {
    id: state.id,
    snippet: { ...state.snippet, ...snippet },
    status: { ...state.status, ...reply.status },
    localizations: reply.localizations ?? state.localizations,
  }
}

/**
 * The digest of the writable properties of every part the writes read, which
 * the prompt pins: a video changed after the prompt gives another one, so the
 * call is `stale`.
 */
export function statePin({ snippet, status, localizations }: VideoState): string {
  return createHash("sha256").update(canonicalJson({ snippet, status, localizations })).digest("hex")
}
