import { z } from "zod"
import { channelUrl, clippedDescription, countReply, descriptionShape, toCount } from "./views"

/** A channel as `channels.list` gives it, with the parts `snippet`, `statistics` and `contentDetails`; every field not read here is left out of the parse. */
export const channelReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string().optional(),
      customUrl: z.string().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      subscriberCount: countReply,
      hiddenSubscriberCount: z.boolean().optional(),
      videoCount: countReply,
      viewCount: countReply,
    })
    .optional(),
  contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).optional() }).optional(),
})

export const channelSchema = z.object({
  channel_id: z.string(),
  title: z.string(),
  /** The channel's `@handle`. */
  handle: z.string().nullable(),
  ...descriptionShape,
  published_at: z.string().nullable(),
  country: z.string().nullable(),
  /** `null` when the channel hides it. */
  subscriber_count: z.number().nullable(),
  video_count: z.number().nullable(),
  view_count: z.number().nullable(),
  /** The playlist of every public upload, which `playlist` reads. */
  uploads_playlist_id: z.string().nullable(),
  url: z.string(),
})

export type ChannelView = z.output<typeof channelSchema>

/** What the read returns of a channel. */
export function channelView(channel: z.output<typeof channelReply>): ChannelView {
  const { snippet, statistics, contentDetails } = channel
  return {
    channel_id: channel.id,
    title: snippet?.title ?? "",
    handle: snippet?.customUrl ?? null,
    ...clippedDescription(snippet?.description),
    published_at: snippet?.publishedAt ?? null,
    country: snippet?.country ?? null,
    subscriber_count: statistics?.hiddenSubscriberCount ? null : toCount(statistics?.subscriberCount),
    video_count: toCount(statistics?.videoCount),
    view_count: toCount(statistics?.viewCount),
    uploads_playlist_id: contentDetails?.relatedPlaylists?.uploads ?? null,
    url: channelUrl(channel.id),
  }
}
