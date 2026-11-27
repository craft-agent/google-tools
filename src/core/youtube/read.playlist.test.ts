import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_ITEMS_URL,
  VIDEO,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  requestLine,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const PARTS = "snippet,contentDetails,status"

const playlistResource = (extra: Record<string, unknown> = {}) => ({
  id: PLAYLIST,
  snippet: { title: "A made-up list", description: "Videos.", channelId: CHANNEL, channelTitle: "Made-up channel" },
  contentDetails: { itemCount: 2 },
  status: { privacyStatus: "public" },
  ...extra,
})

const itemResource = (position: number, extra: Record<string, unknown> = {}) => ({
  id: `item${position}`,
  snippet: {
    position,
    title: "An item",
    videoOwnerChannelId: OTHER_CHANNEL,
    videoOwnerChannelTitle: "Owner",
    resourceId: { kind: "youtube#video", videoId: VIDEO },
  },
  contentDetails: { videoId: VIDEO, videoPublishedAt: "2026-03-01T09:00:00Z" },
  status: { privacyStatus: "public" },
  ...extra,
})

const fixtureOf = (items: unknown[], extra: Record<string, unknown> = {}) =>
  fixture([answer(PLAYLISTS_URL, { items: [playlistResource()] }), answer(PLAYLIST_ITEMS_URL, { items, ...extra })])

describe("google_youtube_read playlist", () => {
  test("reads the playlist, then one page of its items", async () => {
    const h = await fixtureOf([])

    await h.read({ method: "playlist", playlist: PLAYLIST })

    expect(h.calls().map(requestLine)).toEqual([`GET ${PLAYLISTS_URL}`, `GET ${PLAYLIST_ITEMS_URL}`])
    expect(queryOf(h, 0)).toEqual({ part: PARTS, id: PLAYLIST })
    expect(queryOf(h, 1)).toEqual({ part: PARTS, playlistId: PLAYLIST, maxResults: "25" })
  })

  test("takes an address with `list=`, the limit and the page token", async () => {
    const h = await fixtureOf([])

    await h.read({
      method: "playlist",
      playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      limit: 50,
      page_token: "CAoQAA",
    })

    expect(queryOf(h, 0)).toEqual({ part: PARTS, id: PLAYLIST })
    expect(queryOf(h, 1)).toEqual({ part: PARTS, playlistId: PLAYLIST, maxResults: "50", pageToken: "CAoQAA" })
  })

  test("returns the playlist and its items as views, with the next page", async () => {
    const hidden = { id: undefined, snippet: { position: 1, title: "Private video" }, contentDetails: {}, status: {} }
    const h = await fixtureOf([itemResource(0), itemResource(1, hidden)], { nextPageToken: "CBkQAA" })

    expect(await h.read({ method: "playlist", playlist: PLAYLIST })).toEqual({
      playlist: {
        playlist_id: PLAYLIST,
        title: "A made-up list",
        channel_id: CHANNEL,
        channel_title: "Made-up channel",
        description: "Videos.",
        description_clipped: false,
        item_count: 2,
        privacy: "public",
        url: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      },
      items: [
        {
          playlist_item_id: "item0",
          position: 0,
          video_id: VIDEO,
          title: "An item",
          video_owner_channel_id: OTHER_CHANNEL,
          video_owner_channel_title: "Owner",
          video_published_at: "2026-03-01T09:00:00Z",
          privacy: "public",
          url: `https://www.youtube.com/watch?v=${VIDEO}`,
        },
        {
          playlist_item_id: null,
          position: 1,
          video_id: null,
          title: "Private video",
          video_owner_channel_id: null,
          video_owner_channel_title: null,
          video_published_at: null,
          privacy: null,
          url: null,
        },
      ],
      next_page_token: "CBkQAA",
    })
  })

  test("a video id the item holds only in its resource is read from there", async () => {
    const item = itemResource(0, { contentDetails: {} })
    const h = await fixtureOf([item])

    const result = await h.read({ method: "playlist", playlist: PLAYLIST })

    expect(result.items?.[0]).toMatchObject({ video_id: VIDEO, video_published_at: null })
  })

  test("a playlist Google returns nothing for is not_found, and its items are not asked for", async () => {
    const h = await fixture([answer(PLAYLISTS_URL, { items: [] }), answer(PLAYLIST_ITEMS_URL, { items: [] })])

    await expect(h.read({ method: "playlist", playlist: PLAYLIST })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining(PLAYLIST),
    })
    expect(h.calls().map(requestLine)).toEqual([`GET ${PLAYLISTS_URL}`])
  })

  test("a description of more than 2000 characters is clipped and says so", async () => {
    const h = await fixture([
      answer(PLAYLISTS_URL, { items: [playlistResource({ snippet: { title: "t", description: "z".repeat(2001) } })] }),
      answer(PLAYLIST_ITEMS_URL, {}),
    ])

    const result = await h.read({ method: "playlist", playlist: PLAYLIST })

    expect(result.playlist).toMatchObject({ description: "z".repeat(2000), description_clipped: true })
  })

  test.each([
    ["a limit of 51", { limit: 51 }, "Method playlist takes a `limit` of 1 to 50."],
    ["a query", { query: "q" }, "Method playlist takes no `query`."],
    ["a video", { video: VIDEO }, "Method playlist takes no `video`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra, message) => {
    const h = await fixtureOf([])

    await expect(h.read({ method: "playlist", playlist: PLAYLIST, ...extra })).rejects.toMatchObject({
      code: "invalid_argument",
      message,
    })
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a playlist id with a slash", "PL/abc"],
    ["an address without `list=`", "https://www.youtube.com/playlist"],
    ["a one-letter id", "P"],
  ])("%s is invalid_argument, and sends nothing", async (_name, playlist) => {
    const h = await fixtureOf([])

    await expect(h.read({ method: "playlist", playlist })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
