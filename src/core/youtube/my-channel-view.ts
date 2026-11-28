import { z } from "zod"
import { channelReply } from "./channel-view"
import { channelUrl, clippedDescription, descriptionShape, toCount } from "./views"

/** Matches a keyword as Google writes the list: a phrase in double quotes, or a word. */
const KEYWORD_PATTERN = /"([^"]*)"|(\S+)/g

/** A channel as `channels.list` gives it with `mine=true` and the parts `snippet`, `brandingSettings`, `status`, `statistics` and `contentDetails`; every field not read here is left out of the parse. */
export const myChannelReply = channelReply.extend({
  snippet: channelReply.shape.snippet.unwrap().extend({ defaultLanguage: z.string().optional() }).optional(),
  brandingSettings: z.object({ channel: z.object({ keywords: z.string().optional() }).optional() }).optional(),
  status: z
    .object({
      privacyStatus: z.string().optional(),
      madeForKids: z.boolean().optional(),
      selfDeclaredMadeForKids: z.boolean().optional(),
      longUploadsStatus: z.string().optional(),
    })
    .optional(),
})

export const myChannelsList = z.object({ items: z.array(myChannelReply).optional() })

export const myChannelSchema = z.object({
  channel_id: z.string(),
  title: z.string(),
  /** The channel's `@handle`. */
  handle: z.string().nullable(),
  ...descriptionShape,
  /** The channel's keywords, a phrase Google quoted as one. */
  keywords: z.array(z.string()),
  country: z.string().nullable(),
  default_language: z.string().nullable(),
  /** `public`, `unlisted` or `private`. */
  privacy: z.string().nullable(),
  made_for_kids: z.boolean().nullable(),
  self_declared_made_for_kids: z.boolean().nullable(),
  /** Whether the channel may upload videos longer than 15 minutes: `allowed`, `eligible` or `longUploadsUnspecified`. */
  long_uploads: z.string().nullable(),
  /** `null` when the channel hides it. */
  subscriber_count: z.number().nullable(),
  video_count: z.number().nullable(),
  view_count: z.number().nullable(),
  /** The playlist of every upload, which `my_videos` reads. */
  uploads_playlist_id: z.string().nullable(),
  url: z.string(),
})

export type MyChannelView = z.output<typeof myChannelSchema>

/** The words of the keywords text of a channel, a quoted phrase as one. */
export function keywordsOf(text: string | undefined): string[] {
  return [...(text ?? "").matchAll(KEYWORD_PATTERN)].flatMap((match) => {
    const keyword = (match[1] ?? match[2] ?? "").trim()
    return keyword === "" ? [] : [keyword]
  })
}

/** What the read returns of the label's own channel. */
export function myChannelView(channel: z.output<typeof myChannelReply>): MyChannelView {
  const { snippet, brandingSettings, status, statistics, contentDetails } = channel
  return {
    channel_id: channel.id,
    title: snippet?.title ?? "",
    handle: snippet?.customUrl ?? null,
    ...clippedDescription(snippet?.description),
    keywords: keywordsOf(brandingSettings?.channel?.keywords),
    country: snippet?.country ?? null,
    default_language: snippet?.defaultLanguage ?? null,
    privacy: status?.privacyStatus ?? null,
    made_for_kids: status?.madeForKids ?? null,
    self_declared_made_for_kids: status?.selfDeclaredMadeForKids ?? null,
    long_uploads: status?.longUploadsStatus ?? null,
    subscriber_count: statistics?.hiddenSubscriberCount ? null : toCount(statistics?.subscriberCount),
    video_count: toCount(statistics?.videoCount),
    view_count: toCount(statistics?.viewCount),
    uploads_playlist_id: contentDetails?.relatedPlaylists?.uploads ?? null,
    url: channelUrl(channel.id),
  }
}
