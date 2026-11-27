import { z } from "zod"
import { clippedDescription, countReply, descriptionShape, toCount, videoUrl } from "./views"

/** A video as `videos.list` gives it, with the parts `snippet`, `contentDetails`, `statistics` and `status`; every field not read here is left out of the parse. */
export const videoReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      tags: z.array(z.string()).optional(),
      liveBroadcastContent: z.string().optional(),
    })
    .optional(),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
  statistics: z.object({ viewCount: countReply, likeCount: countReply, commentCount: countReply }).optional(),
  status: z.object({ privacyStatus: z.string().optional(), madeForKids: z.boolean().optional() }).optional(),
})

export const videoSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  channel_id: z.string().nullable(),
  channel_title: z.string().nullable(),
  published_at: z.string().nullable(),
  ...descriptionShape,
  tags: z.array(z.string()),
  /** ISO 8601, as Google gives it (`PT4M13S`). */
  duration: z.string().nullable(),
  /** `none`, `live` or `upcoming`: whether the video is a live broadcast. */
  live: z.string().nullable(),
  /** `public`, `unlisted` or `private`. */
  privacy: z.string().nullable(),
  made_for_kids: z.boolean().nullable(),
  /** Counts are `null` when the owner hides them or Google gives none. */
  view_count: z.number().nullable(),
  like_count: z.number().nullable(),
  comment_count: z.number().nullable(),
  url: z.string(),
})

export type VideoView = z.output<typeof videoSchema>

/** What the read returns of a video. */
export function videoView(video: z.output<typeof videoReply>): VideoView {
  const { snippet, contentDetails, statistics, status } = video
  return {
    video_id: video.id,
    title: snippet?.title ?? "",
    channel_id: snippet?.channelId ?? null,
    channel_title: snippet?.channelTitle ?? null,
    published_at: snippet?.publishedAt ?? null,
    ...clippedDescription(snippet?.description),
    tags: snippet?.tags ?? [],
    duration: contentDetails?.duration ?? null,
    live: snippet?.liveBroadcastContent ?? null,
    privacy: status?.privacyStatus ?? null,
    made_for_kids: status?.madeForKids ?? null,
    view_count: toCount(statistics?.viewCount),
    like_count: toCount(statistics?.likeCount),
    comment_count: toCount(statistics?.commentCount),
    url: videoUrl(video.id),
  }
}
