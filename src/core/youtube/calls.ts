import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { QueryValue } from "../google/routes"
import { shown } from "../run/ids"
import { parseReply } from "../sheets/reply"
import type { ChannelAsk, CommentsRequest, SearchRequest } from "./args"
import { channelReply, channelView, type ChannelView } from "./channel-view"
import { repliesList, commentView, threadView, threadsList, type CommentView } from "./comment-view"
import type { ChannelRef } from "./ids"
import type { Page } from "./paging"
import {
  playlistItemView,
  playlistItemsList,
  playlistView,
  playlistsList,
  type PlaylistItemView,
  type PlaylistView,
} from "./playlist-view"
import { YOUTUBE_ROUTES } from "./routes"
import { searchList, searchResults, type SearchResult } from "./search-view"
import { videoReply, videoView, type VideoView } from "./video-view"
import type { Listed } from "./views"

export const VIDEO_PARTS = "snippet,contentDetails,statistics,status"
const CHANNEL_PARTS = "snippet,statistics,contentDetails"
export const PLAYLIST_PARTS = "snippet,contentDetails,status"

/** The reason of the 403 Google answers when the owner turned the comments of a video off. */
const COMMENTS_DISABLED = "commentsDisabled"

const videosList = z.object({ items: z.array(videoReply).optional() })
const channelsList = z.object({ items: z.array(channelReply).optional() })

/** The query every list call of a page carries. */
export const pageQuery = (page: Page) => ({ maxResults: page.maxResults, pageToken: page.pageToken })

/** The videos of `ids` as `videos.list` gives them, with the `part`s of them; the ones Google did not return are left out. */
export async function listVideos(client: GoogleClient, ids: readonly string[], part: string) {
  const reply = await client.request(YOUTUBE_ROUTES.videos, { query: { part, id: ids.join(",") } })
  return parseReply(videosList, reply, "the video list").items ?? []
}

/** The channels `filter` names (`id` or `forHandle`), with the `part`s of them. */
async function listChannels(client: GoogleClient, filter: Record<string, string>, part: string) {
  const reply = await client.request(YOUTUBE_ROUTES.channels, { query: { part, ...filter } })
  return parseReply(channelsList, reply, "the channel list").items ?? []
}

/** The id of the channel `ref` names; a handle is looked up, and one no channel has is `not_found`. */
async function channelIdOf(client: GoogleClient, ref: ChannelRef): Promise<string> {
  if (ref.id !== undefined) return ref.id
  const [channel] = await listChannels(client, { forHandle: ref.handle }, "id")
  if (channel === undefined) throw new ToolError("not_found", `The channel ${shown(ref.handle)} was not found.`)
  return channel.id
}

/** One page of a search, with Google's estimate of everything it matches. */
export async function searchYoutube(
  client: GoogleClient,
  request: SearchRequest,
): Promise<Listed<"results", SearchResult> & { total_results: number | null }> {
  const channelId = request.channel === undefined ? undefined : await channelIdOf(client, request.channel)
  const reply = await client.request(YOUTUBE_ROUTES.search, {
    query: {
      part: "snippet",
      type: request.kind,
      q: request.query,
      channelId,
      order: request.order,
      publishedAfter: request.publishedAfter,
      publishedBefore: request.publishedBefore,
      videoDuration: request.duration,
      relevanceLanguage: request.language,
      regionCode: request.region,
      ...pageQuery(request.page),
    },
  })
  const listed = parseReply(searchList, reply, "the search")
  return {
    results: searchResults(request.kind, listed),
    next_page_token: listed.nextPageToken ?? null,
    total_results: listed.pageInfo?.totalResults ?? null,
  }
}

/** The videos of `ids` in the order given, and the ids Google did not return. */
export async function readVideos(
  client: GoogleClient,
  ids: readonly string[],
): Promise<{ videos: VideoView[]; not_found: string[] }> {
  const found = new Map((await listVideos(client, ids, VIDEO_PARTS)).map((video) => [video.id, video]))
  return {
    videos: ids.flatMap((id) => {
      const video = found.get(id)
      return video === undefined ? [] : [videoView(video)]
    }),
    not_found: ids.filter((id) => !found.has(id)),
  }
}

/** The channels asked for in the order given, and the values given of those Google did not return; the ids go in one call and each handle takes its own. */
export async function readChannels(
  client: GoogleClient,
  asks: readonly ChannelAsk[],
): Promise<{ channels: ChannelView[]; not_found: string[] }> {
  const ids = asks.flatMap(({ ref }) => (ref.id === undefined ? [] : [ref.id]))
  const byId = new Map(
    (ids.length === 0 ? [] : await listChannels(client, { id: ids.join(",") }, CHANNEL_PARTS)).map((channel) => [
      channel.id,
      channel,
    ]),
  )
  const channels: ChannelView[] = []
  const notFound: string[] = []
  for (const { given, ref } of asks) {
    const channel =
      ref.id === undefined
        ? (await listChannels(client, { forHandle: ref.handle }, CHANNEL_PARTS))[0]
        : byId.get(ref.id)
    if (channel === undefined) notFound.push(given)
    else channels.push(channelView(channel))
  }
  return { channels, not_found: notFound }
}

/** A playlist and one page of its items; a playlist Google returns nothing for is `not_found`. */
export async function readPlaylist(
  client: GoogleClient,
  id: string,
  page: Page,
): Promise<{ playlist: PlaylistView; items: PlaylistItemView[]; next_page_token: string | null }> {
  const found = await client.request(YOUTUBE_ROUTES.playlists, { query: { part: PLAYLIST_PARTS, id } })
  const [playlist] = parseReply(playlistsList, found, "the playlist").items ?? []
  if (playlist === undefined) throw new ToolError("not_found", `The playlist ${shown(id)} was not found.`)
  const reply = await client.request(YOUTUBE_ROUTES.playlistItems, {
    query: { part: PLAYLIST_PARTS, playlistId: id, ...pageQuery(page) },
  })
  const listed = parseReply(playlistItemsList, reply, "the playlist's items")
  return {
    playlist: playlistView(playlist),
    items: (listed.items ?? []).map(playlistItemView),
    next_page_token: listed.nextPageToken ?? null,
  }
}

/** One comments call; a video whose comments are turned off is `forbidden`, which Google answers with a reason the client does not map. */
async function requestComments(
  client: GoogleClient,
  route: typeof YOUTUBE_ROUTES.commentThreads | typeof YOUTUBE_ROUTES.comments,
  query: Record<string, QueryValue>,
): Promise<unknown> {
  try {
    return await client.request(route, { query: { ...query, textFormat: "plainText" } })
  } catch (error) {
    if (isToolError(error) && error.details?.reason === COMMENTS_DISABLED) {
      throw new ToolError("forbidden", "Comments are turned off for this video.", {
        cause: error,
        details: error.details,
      })
    }
    throw error
  }
}

/**
 * One page of the comment threads of a video, or of the replies of a thread.
 * Google serves both only to `youtube.force-ssl`, so a label without it is
 * refused before anything is sent.
 */
export async function readComments(
  client: GoogleClient,
  request: CommentsRequest,
): Promise<Listed<"comments", CommentView>> {
  if ("thread" in request) {
    await client.requireScopes(YOUTUBE_ROUTES.comments)
    const reply = await requestComments(client, YOUTUBE_ROUTES.comments, {
      part: "snippet",
      parentId: request.thread,
      ...pageQuery(request.page),
    })
    const listed = parseReply(repliesList, reply, "the replies")
    return { comments: (listed.items ?? []).map(commentView), next_page_token: listed.nextPageToken ?? null }
  }
  await client.requireScopes(YOUTUBE_ROUTES.commentThreads)
  const reply = await requestComments(client, YOUTUBE_ROUTES.commentThreads, {
    part: "snippet,replies",
    videoId: request.video,
    order: request.order,
    searchTerms: request.searchTerms,
    ...pageQuery(request.page),
  })
  const listed = parseReply(threadsList, reply, "the comment threads")
  return { comments: (listed.items ?? []).map(threadView), next_page_token: listed.nextPageToken ?? null }
}
