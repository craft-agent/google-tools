import { z } from "zod"
import { clippedDescription, descriptionShape, pageReply, playlistUrl, videoUrl } from "./views"

/** A playlist as `playlists.list` gives it, with the parts `snippet`, `contentDetails` and `status`; every field not read here is left out of the parse. */
export const playlistReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
    })
    .optional(),
  contentDetails: z.object({ itemCount: z.number().optional() }).optional(),
  status: z.object({ privacyStatus: z.string().optional() }).optional(),
})

/** An item of a playlist as `playlistItems.list` gives it, with the parts `snippet`, `contentDetails` and `status`. */
const playlistItemReply = z.object({
  id: z.string().optional(),
  snippet: z
    .object({
      position: z.number().optional(),
      title: z.string().optional(),
      videoOwnerChannelId: z.string().optional(),
      videoOwnerChannelTitle: z.string().optional(),
      resourceId: z.object({ videoId: z.string().optional() }).optional(),
    })
    .optional(),
  contentDetails: z.object({ videoId: z.string().optional(), videoPublishedAt: z.string().optional() }).optional(),
  status: z.object({ privacyStatus: z.string().optional() }).optional(),
})

export const playlistsList = z.object({ items: z.array(playlistReply).optional() })

export const playlistItemsList = z.object({ items: z.array(playlistItemReply).optional(), ...pageReply })

export const playlistSchema = z.object({
  playlist_id: z.string(),
  title: z.string(),
  channel_id: z.string().nullable(),
  channel_title: z.string().nullable(),
  ...descriptionShape,
  item_count: z.number().nullable(),
  /** `public`, `unlisted` or `private`. */
  privacy: z.string().nullable(),
  url: z.string(),
})

export const playlistItemSchema = z.object({
  /** The item's own id, which a change to the playlist names it by. */
  playlist_item_id: z.string().nullable(),
  position: z.number().nullable(),
  video_id: z.string().nullable(),
  /** Google titles a video that was deleted or made private `Deleted video` or `Private video`. */
  title: z.string(),
  video_owner_channel_id: z.string().nullable(),
  video_owner_channel_title: z.string().nullable(),
  video_published_at: z.string().nullable(),
  /** The video's `public`, `unlisted` or `private` status. */
  privacy: z.string().nullable(),
  url: z.string().nullable(),
})

export type PlaylistView = z.output<typeof playlistSchema>
export type PlaylistItemView = z.output<typeof playlistItemSchema>

/** What the read returns of a playlist. */
export function playlistView(playlist: z.output<typeof playlistReply>): PlaylistView {
  const { snippet, contentDetails, status } = playlist
  return {
    playlist_id: playlist.id,
    title: snippet?.title ?? "",
    channel_id: snippet?.channelId ?? null,
    channel_title: snippet?.channelTitle ?? null,
    ...clippedDescription(snippet?.description),
    item_count: contentDetails?.itemCount ?? null,
    privacy: status?.privacyStatus ?? null,
    url: playlistUrl(playlist.id),
  }
}

/** What the read returns of an item of a playlist. */
export function playlistItemView(item: z.output<typeof playlistItemReply>): PlaylistItemView {
  const { snippet, contentDetails, status } = item
  const videoId = contentDetails?.videoId ?? snippet?.resourceId?.videoId ?? null
  return {
    playlist_item_id: item.id ?? null,
    position: snippet?.position ?? null,
    video_id: videoId,
    title: snippet?.title ?? "",
    video_owner_channel_id: snippet?.videoOwnerChannelId ?? null,
    video_owner_channel_title: snippet?.videoOwnerChannelTitle ?? null,
    video_published_at: contentDetails?.videoPublishedAt ?? null,
    privacy: status?.privacyStatus ?? null,
    url: videoId === null ? null : videoUrl(videoId),
  }
}
