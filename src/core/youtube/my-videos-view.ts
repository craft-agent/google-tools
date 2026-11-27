import { z } from "zod"
import type { PlaylistItemView } from "./playlist-view"
import { videoReply, videoSchema, videoView, type VideoView } from "./video-view"
import { videoUrl } from "./views"

/** A video of the label's channel: the video view, with the time a scheduled one goes public. */
export const ownVideoSchema = videoSchema.extend({
  /** When a scheduled video goes public, RFC 3339; `null` for one that is not scheduled. Only `my_videos` fills it. */
  publish_at: z.string().nullable().optional(),
})

export type OwnVideoView = VideoView & { publish_at: string | null }

/** What `my_videos` returns of a video `videos.list` gave. */
export function ownVideoView(video: z.output<typeof videoReply>): OwnVideoView {
  return { ...videoView(video), publish_at: video.status?.publishAt ?? null }
}

/** What `my_videos` returns of an upload `videos.list` did not give: what its playlist item says, the other fields empty. */
export function listedVideoView(id: string, item: PlaylistItemView): OwnVideoView {
  return {
    video_id: id,
    title: item.title,
    channel_id: null,
    channel_title: null,
    published_at: null,
    description: "",
    description_clipped: false,
    tags: [],
    duration: null,
    live: null,
    privacy: item.privacy,
    made_for_kids: null,
    view_count: null,
    like_count: null,
    comment_count: null,
    url: videoUrl(id),
    publish_at: null,
  }
}
