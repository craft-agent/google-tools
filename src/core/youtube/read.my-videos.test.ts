import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  CHANNELS_URL,
  OTHER_VIDEO,
  PLAYLIST_ITEMS_URL,
  UPLOADS,
  VIDEO,
  VIDEOS_URL,
  answer,
  channelResource,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  requestLine,
  videoResource,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const ITEM_PARTS = "snippet,contentDetails,status"
const VIDEO_PARTS = "snippet,contentDetails,statistics,status"

const uploadItem = (id: string, title: string, privacy = "public") => ({
  id: `item-${id}`,
  snippet: { position: 0, title, resourceId: { videoId: id } },
  contentDetails: { videoId: id },
  status: { privacyStatus: privacy },
})

const fixtureOf = (items: unknown[], videos: unknown[], extra: Record<string, unknown> = {}) =>
  fixture([
    answer(CHANNELS_URL, { items: [channelResource()] }),
    answer(PLAYLIST_ITEMS_URL, { items, ...extra }),
    answer(VIDEOS_URL, { items: videos }),
  ])

describe("google_youtube_read my_videos", () => {
  test("finds the uploads playlist of the channel, reads a page of it, then the videos in one call", async () => {
    const h = await fixtureOf([uploadItem(VIDEO, "One"), uploadItem(OTHER_VIDEO, "Two")], [])

    await h.read({ method: "my_videos" })

    expect(h.calls().map(requestLine)).toEqual([
      `GET ${CHANNELS_URL}`,
      `GET ${PLAYLIST_ITEMS_URL}`,
      `GET ${VIDEOS_URL}`,
    ])
    expect(queryOf(h, 0)).toEqual({ part: "contentDetails", mine: "true" })
    expect(queryOf(h, 1)).toEqual({ part: ITEM_PARTS, playlistId: UPLOADS, maxResults: "25" })
    expect(queryOf(h, 2)).toEqual({ part: VIDEO_PARTS, id: `${VIDEO},${OTHER_VIDEO}` })
  })

  test("sends the limit and the page token", async () => {
    const h = await fixtureOf([uploadItem(VIDEO, "One")], [])

    await h.read({ method: "my_videos", limit: 50, page_token: "CAoQAA" })

    expect(queryOf(h, 1)).toEqual({ part: ITEM_PARTS, playlistId: UPLOADS, maxResults: "50", pageToken: "CAoQAA" })
  })

  test("returns the videos in the order of the playlist, with the time a scheduled one goes public", async () => {
    const scheduled = videoResource(OTHER_VIDEO, {
      status: { privacyStatus: "private", madeForKids: false, publishAt: "2026-07-01T09:00:00Z" },
    })
    const h = await fixtureOf(
      [uploadItem(OTHER_VIDEO, "Two", "private"), uploadItem(VIDEO, "One")],
      [videoResource(VIDEO), scheduled],
      { nextPageToken: "CBkQAA" },
    )

    const result = await h.read({ method: "my_videos" })

    expect(result.channel_id).toBe(CHANNEL)
    expect(result.next_page_token).toBe("CBkQAA")
    expect(result.videos).toEqual([
      expect.objectContaining({ video_id: OTHER_VIDEO, privacy: "private", publish_at: "2026-07-01T09:00:00Z" }),
      expect.objectContaining({
        video_id: VIDEO,
        title: "A made-up video",
        privacy: "public",
        view_count: 1200,
        publish_at: null,
      }),
    ])
  })

  test("an upload Google did not return is told from its playlist item, the other fields null", async () => {
    const h = await fixtureOf(
      [uploadItem(VIDEO, "One"), uploadItem(OTHER_VIDEO, "Gone", "unlisted")],
      [videoResource(VIDEO)],
    )

    const result = await h.read({ method: "my_videos" })

    expect(result.videos?.[1]).toEqual({
      video_id: OTHER_VIDEO,
      title: "Gone",
      channel_id: null,
      channel_title: null,
      published_at: null,
      description: "",
      description_clipped: false,
      tags: [],
      duration: null,
      live: null,
      privacy: "unlisted",
      made_for_kids: null,
      view_count: null,
      like_count: null,
      comment_count: null,
      url: `https://www.youtube.com/watch?v=${OTHER_VIDEO}`,
      publish_at: null,
    })
  })

  test("a channel with no uploads asks for no videos", async () => {
    const h = await fixtureOf([], [])

    expect(await h.read({ method: "my_videos" })).toEqual({ channel_id: CHANNEL, videos: [], next_page_token: null })
    expect(h.calls().map(requestLine)).toEqual([`GET ${CHANNELS_URL}`, `GET ${PLAYLIST_ITEMS_URL}`])
  })

  test("an account with no channel is not_found, and nothing else is asked", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [] }), answer(PLAYLIST_ITEMS_URL, {})])

    await expect(h.read({ method: "my_videos" })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining('Google account "work" has no YouTube channel'),
    })
    expect(h.calls()).toHaveLength(1)
  })

  test.each([
    ["a limit of 51", { limit: 51 }, "Method my_videos takes a `limit` of 1 to 50."],
    ["a video", { video: VIDEO }, "Method my_videos takes no `video`."],
    ["videos", { videos: [VIDEO] }, "Method my_videos takes no `videos`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra, message) => {
    const h = await fixtureOf([], [])

    await expect(h.read({ method: "my_videos", ...extra })).rejects.toMatchObject({
      code: "invalid_argument",
      message,
    })
    expect(h.requests).toEqual([])
  })
})
