import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  CHANNELS_URL,
  PLAYLIST,
  SEARCH_URL,
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

const snippet = (extra: Record<string, unknown> = {}) => ({
  title: "A made-up result",
  description: "About made-up things.",
  publishedAt: "2026-03-01T09:00:00Z",
  channelId: CHANNEL,
  channelTitle: "Made-up channel",
  ...extra,
})

describe("google_youtube_read search", () => {
  test("searches videos by default, with the query's whitespace collapsed", async () => {
    const h = await fixture([answer(SEARCH_URL, { items: [] })])

    expect(await h.read({ method: "search", query: "  cats \n and\tdogs " })).toEqual({
      results: [],
      next_page_token: null,
      total_results: null,
    })

    expect(h.calls().map(requestLine)).toEqual([`GET ${SEARCH_URL}`])
    expect(queryOf(h)).toEqual({
      part: "snippet",
      type: "video",
      q: "cats and dogs",
      order: "relevance",
      maxResults: "10",
    })
  })

  test("returns a video result with its owner and address, the next page and Google's estimate", async () => {
    const h = await fixture([
      answer(SEARCH_URL, {
        items: [{ id: { kind: "youtube#video", videoId: VIDEO }, snippet: snippet() }],
        nextPageToken: "CAoQAA",
        pageInfo: { totalResults: 1234, resultsPerPage: 10 },
      }),
    ])

    expect(await h.read({ method: "search", query: "made up" })).toEqual({
      results: [
        {
          kind: "video",
          video_id: VIDEO,
          channel_id: CHANNEL,
          playlist_id: null,
          title: "A made-up result",
          channel_title: "Made-up channel",
          published_at: "2026-03-01T09:00:00Z",
          description: "About made-up things.",
          description_clipped: false,
          url: `https://www.youtube.com/watch?v=${VIDEO}`,
        },
      ],
      next_page_token: "CAoQAA",
      total_results: 1234,
    })
  })

  test("decodes the HTML entities Google puts in a result's title, description and channel title", async () => {
    const h = await fixture([
      answer(SEARCH_URL, {
        items: [
          {
            id: { kind: "youtube#video", videoId: VIDEO },
            snippet: snippet({
              title: "Agents &amp; tips &#39;n&#39; tricks",
              description: "Say &quot;hi&quot; &#x1F600; &#99999999; &unknown;",
              channelTitle: "Tom &amp; Jerry",
            }),
          },
        ],
      }),
    ])

    const { results } = await h.read({ method: "search", query: "made up" })

    expect(results?.[0]).toMatchObject({
      title: "Agents & tips 'n' tricks",
      description: 'Say "hi" 😀 &#99999999; &unknown;',
      channel_title: "Tom & Jerry",
    })
  })

  test("a channel result is the channel itself, a playlist result has its owner", async () => {
    const channels = await fixture([
      answer(SEARCH_URL, { items: [{ id: { channelId: CHANNEL }, snippet: snippet({ channelId: CHANNEL }) }] }),
    ])
    const playlists = await fixture([
      answer(SEARCH_URL, { items: [{ id: { playlistId: PLAYLIST }, snippet: snippet() }] }),
    ])

    const [channel] = (await channels.read({ method: "search", query: "q", kind: "channel" })).results!
    const [playlist] = (await playlists.read({ method: "search", query: "q", kind: "playlist" })).results!

    expect(channel).toMatchObject({
      kind: "channel",
      video_id: null,
      channel_id: CHANNEL,
      playlist_id: null,
      url: `https://www.youtube.com/channel/${CHANNEL}`,
    })
    expect(playlist).toMatchObject({
      kind: "playlist",
      video_id: null,
      channel_id: CHANNEL,
      playlist_id: PLAYLIST,
      url: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
    })
    expect(queryOf(channels).type).toBe("channel")
    expect(queryOf(playlists).type).toBe("playlist")
  })

  test("a result without the id of its kind is left out", async () => {
    const h = await fixture([
      answer(SEARCH_URL, {
        items: [
          { id: { channelId: CHANNEL }, snippet: snippet() },
          { id: { videoId: VIDEO }, snippet: snippet() },
        ],
      }),
    ])

    const result = await h.read({ method: "search", query: "q" })

    expect(result.results?.map((entry) => entry.video_id)).toEqual([VIDEO])
  })

  test("sends every argument as Google names it", async () => {
    const h = await fixture([answer(SEARCH_URL, {})])

    await h.read({
      method: "search",
      query: "q",
      channel: CHANNEL,
      kind: "video",
      order: "view_count",
      published_after: "2026-01-01",
      published_before: "2026-02-28",
      duration: "long",
      language: "zh-Hans",
      region: "jp",
      limit: 50,
      page_token: "CAoQAA",
    })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({
      part: "snippet",
      type: "video",
      q: "q",
      channelId: CHANNEL,
      order: "viewCount",
      publishedAfter: "2026-01-01T00:00:00Z",
      publishedBefore: "2026-02-28T00:00:00Z",
      videoDuration: "long",
      relevanceLanguage: "zh-Hans",
      regionCode: "JP",
      maxResults: "50",
      pageToken: "CAoQAA",
    })
  })

  test.each([
    ["date", "date"],
    ["rating", "rating"],
    ["title", "title"],
  ])("order %s is sent as %s", async (order, sent) => {
    const h = await fixture([answer(SEARCH_URL, {})])

    await h.read({ method: "search", query: "q", order })

    expect(queryOf(h).order).toBe(sent)
  })

  test("a channel alone is enough, and a day equal to the other is allowed", async () => {
    const h = await fixture([answer(SEARCH_URL, {})])

    await h.read({
      method: "search",
      channel: `https://www.youtube.com/channel/${CHANNEL}`,
      published_after: "2026-02-01",
      published_before: "2026-02-01",
    })

    expect(queryOf(h)).toMatchObject({ channelId: CHANNEL })
    expect(queryOf(h)).not.toHaveProperty("q")
  })

  test("a handle is looked up with one call, and its channel id is searched", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [{ id: CHANNEL }] }), answer(SEARCH_URL, { items: [] })])

    await h.read({ method: "search", channel: "@madeup" })

    expect(h.calls().map(requestLine)).toEqual([`GET ${CHANNELS_URL}`, `GET ${SEARCH_URL}`])
    expect(queryOf(h, 0)).toEqual({ part: "id", forHandle: "@madeup" })
    expect(queryOf(h, 1)).toMatchObject({ channelId: CHANNEL })
  })

  test("a handle no channel has is not_found, and no search is sent", async () => {
    const h = await fixture([answer(CHANNELS_URL, {}), answer(SEARCH_URL, { items: [] })])

    await expect(h.read({ method: "search", channel: "@nobody" })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("@nobody"),
    })
    expect(h.calls().map(requestLine)).toEqual([`GET ${CHANNELS_URL}`])
  })

  test("a description of more than 2000 characters is clipped and says so", async () => {
    const long = "あ".repeat(2001)
    const h = await fixture([
      answer(SEARCH_URL, {
        items: [
          { id: { videoId: VIDEO }, snippet: snippet({ description: long }) },
          { id: { videoId: VIDEO }, snippet: snippet({ description: long.slice(1) }) },
        ],
      }),
    ])

    const [clipped, whole] = (await h.read({ method: "search", query: "q" })).results!

    expect(clipped).toMatchObject({ description: "あ".repeat(2000), description_clipped: true })
    expect(whole).toMatchObject({ description: "あ".repeat(2000), description_clipped: false })
  })
})

describe("google_youtube_read search arguments", () => {
  test.each([
    ["neither a query nor a channel", { method: "search" }, "Method search needs `query` or `channel`."],
    ["a blank query", { method: "search", query: " \n " }, "`query` is empty."],
    [
      "a query of 201 characters",
      { method: "search", query: "a".repeat(201) },
      "`query` is longer than 200 characters.",
    ],
    [
      "a duration for channels",
      { method: "search", query: "q", kind: "channel", duration: "short" },
      "`duration` goes with kind `video` only.",
    ],
    [
      "a date that does not exist",
      { method: "search", query: "q", published_after: "2026-02-30" },
      "`published_after` is not a date as YYYY-MM-DD.",
    ],
    [
      "a date in another shape",
      { method: "search", query: "q", published_before: "2026/02/01" },
      "`published_before` is not a date as YYYY-MM-DD.",
    ],
    [
      "an after later than the before",
      { method: "search", query: "q", published_after: "2026-03-01", published_before: "2026-02-28" },
      "`published_after` is later than `published_before`.",
    ],
    [
      "a language that is no code",
      { method: "search", query: "q", language: "japanese!" },
      "`language` is not a language code such as `ja` or `zh-Hans`.",
    ],
    [
      "a region of three letters",
      { method: "search", query: "q", region: "JPN" },
      "`region` is not a two-letter country code such as `JP`.",
    ],
    [
      "an order only comments take",
      { method: "search", query: "q", order: "time" },
      "Method search takes an `order` of relevance, date, view_count, rating, title.",
    ],
    ["a limit of 51", { method: "search", query: "q", limit: 51 }, "Method search takes a `limit` of 1 to 50."],
    ["a thread", { method: "search", query: "q", thread: "x" }, "Method search takes no `thread`."],
    ["videos", { method: "search", query: "q", videos: [VIDEO] }, "Method search takes no `videos`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, args, message) => {
    const h = await fixture([])

    await expect(h.read(args)).rejects.toMatchObject({ code: "invalid_argument", message })
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a channel that is no channel", { channel: "madeup" }],
    ["a page token that is no token", { query: "q", page_token: "not a token" }],
    ["a limit of 0", { query: "q", limit: 0 }],
    ["a kind Google has not", { query: "q", kind: "movie" }],
  ])("%s is invalid_argument, and sends nothing", async (_name, args) => {
    const h = await fixture([])

    await expect(h.read({ method: "search", ...args })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
