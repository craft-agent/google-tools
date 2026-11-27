import { z } from "zod"
import {
  channelUrl,
  clippedDescription,
  decodeEntities,
  descriptionShape,
  pageReply,
  playlistUrl,
  videoUrl,
} from "./views"

/** What a search looks for. */
export const SEARCH_KINDS = ["video", "channel", "playlist"] as const

export type SearchKind = (typeof SEARCH_KINDS)[number]

/** A result of `search.list` as Google gives it; every field not read here is left out of the parse. */
const searchItemReply = z.object({
  id: z.object({ videoId: z.string().optional(), channelId: z.string().optional(), playlistId: z.string().optional() }),
  snippet: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
    })
    .optional(),
})

type SearchItemReply = z.output<typeof searchItemReply>

/** `search.list` as Google gives it. */
export const searchList = z.object({
  items: z.array(searchItemReply).optional(),
  pageInfo: z.object({ totalResults: z.number().optional() }).optional(),
  ...pageReply,
})

export const searchResultSchema = z.object({
  kind: z.enum(SEARCH_KINDS),
  /** The video, for a video result; `null` otherwise. */
  video_id: z.string().nullable(),
  /** The channel itself for a channel result, the video's or playlist's owner otherwise. */
  channel_id: z.string().nullable(),
  /** The playlist, for a playlist result; `null` otherwise. */
  playlist_id: z.string().nullable(),
  title: z.string(),
  channel_title: z.string().nullable(),
  published_at: z.string().nullable(),
  ...descriptionShape,
  url: z.string(),
})

export type SearchResult = z.output<typeof searchResultSchema>

/** The id and address a result of `kind` is known by; a result without its id is `undefined`. */
function identity(kind: SearchKind, item: SearchItemReply) {
  const { snippet } = item
  if (kind === "video" && item.id.videoId !== undefined) {
    const id = item.id.videoId
    return { video_id: id, channel_id: snippet?.channelId ?? null, playlist_id: null, url: videoUrl(id) }
  }
  if (kind === "channel" && item.id.channelId !== undefined) {
    const id = item.id.channelId
    return { video_id: null, channel_id: id, playlist_id: null, url: channelUrl(id) }
  }
  if (kind === "playlist" && item.id.playlistId !== undefined) {
    const id = item.id.playlistId
    return { video_id: null, channel_id: snippet?.channelId ?? null, playlist_id: id, url: playlistUrl(id) }
  }
  return undefined
}

/** What the read returns of the results of a search for `kind`; one that lacks the id of its kind is left out. */
export function searchResults(kind: SearchKind, listed: z.output<typeof searchList>): SearchResult[] {
  return (listed.items ?? []).flatMap((item) => {
    const found = identity(kind, item)
    if (found === undefined) return []
    const { snippet } = item
    return {
      kind,
      ...found,
      title: decodeEntities(snippet?.title ?? ""),
      channel_title: snippet?.channelTitle === undefined ? null : decodeEntities(snippet.channelTitle),
      published_at: snippet?.publishedAt ?? null,
      ...clippedDescription(snippet?.description === undefined ? undefined : decodeEntities(snippet.description)),
    }
  })
}
