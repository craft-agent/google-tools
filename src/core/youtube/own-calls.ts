import type { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleSession } from "../google/session"
import { parseReply } from "../sheets/reply"
import { captionView, captionsList, type CaptionView } from "./caption-view"
import { PLAYLIST_PARTS, VIDEO_PARTS, listVideos, pageQuery } from "./calls"
import { myChannelReply, myChannelView, myChannelsList, type MyChannelView } from "./my-channel-view"
import { listedVideoView, ownVideoView, type OwnVideoView } from "./my-videos-view"
import type { Page } from "./paging"
import { playlistItemView, playlistItemsList } from "./playlist-view"
import { YOUTUBE_ROUTES } from "./routes"

const MY_CHANNEL_PARTS = "snippet,brandingSettings,status,statistics,contentDetails"
const CAPTION_PARTS = "snippet"

/** What a call for the label's own channel works with: its client and its name. */
export type OwnSession = Pick<GoogleSession, "client" | "label">

/** The label's channel, with the `part`s of it; an account with no YouTube channel is `not_found`. */
export async function ownChannel(session: OwnSession, part: string): Promise<z.output<typeof myChannelReply>> {
  const reply = await session.client.request(YOUTUBE_ROUTES.channels, { query: { part, mine: true } })
  const [channel] = parseReply(myChannelsList, reply, "the channel list").items ?? []
  if (channel === undefined) {
    throw new ToolError(
      "not_found",
      `Google account "${session.label}" has no YouTube channel; it can read public YouTube only (search, videos, channels, playlist, comments).`,
    )
  }
  return channel
}

/** The label's own channel. */
export async function readMyChannel(session: OwnSession): Promise<{ channel: MyChannelView }> {
  return { channel: myChannelView(await ownChannel(session, MY_CHANNEL_PARTS)) }
}

/** One page of the label's uploads, private, unlisted and scheduled ones too, in the order of the uploads playlist. */
export async function readMyVideos(
  session: OwnSession,
  page: Page,
): Promise<{ channel_id: string; videos: OwnVideoView[]; next_page_token: string | null }> {
  const channel = await ownChannel(session, "contentDetails")
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads
  if (uploads === undefined) return { channel_id: channel.id, videos: [], next_page_token: null }
  const reply = await session.client.request(YOUTUBE_ROUTES.playlistItems, {
    query: { part: PLAYLIST_PARTS, playlistId: uploads, ...pageQuery(page) },
  })
  const listed = parseReply(playlistItemsList, reply, "the uploads")
  const items = (listed.items ?? []).map(playlistItemView)
  const ids = items.flatMap((item) => (item.video_id === null ? [] : [item.video_id]))
  const found = new Map(
    (ids.length === 0 ? [] : await listVideos(session.client, ids, VIDEO_PARTS)).map((video) => [video.id, video]),
  )
  return {
    channel_id: channel.id,
    videos: items.flatMap((item) => {
      if (item.video_id === null) return []
      const video = found.get(item.video_id)
      return [video === undefined ? listedVideoView(item.video_id, item) : ownVideoView(video)]
    }),
    next_page_token: listed.nextPageToken ?? null,
  }
}

/**
 * The caption tracks of a video, as Google shows them to the label. Google
 * serves them only to `youtube.force-ssl`, so a label without it is refused
 * before anything is sent.
 */
export async function readCaptions(
  session: OwnSession,
  video: string,
): Promise<{ video_id: string; tracks: CaptionView[] }> {
  await session.client.requireScopes(YOUTUBE_ROUTES.captions)
  const reply = await session.client.request(YOUTUBE_ROUTES.captions, {
    query: { part: CAPTION_PARTS, videoId: video },
  })
  return {
    video_id: video,
    tracks: (parseReply(captionsList, reply, "the caption tracks").items ?? []).map(captionView),
  }
}
