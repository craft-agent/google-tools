import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  CHANNELS_URL,
  OTHER_CHANNEL,
  answer,
  channelResource,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  requestLine,
  respond,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const PARTS = "snippet,statistics,contentDetails"

describe("google_youtube_read channels", () => {
  test("reads the ids in one call", async () => {
    const h = await fixture([
      answer(CHANNELS_URL, { items: [channelResource(CHANNEL), channelResource(OTHER_CHANNEL)] }),
    ])

    await h.read({
      method: "channels",
      channels: [CHANNEL, `https://www.youtube.com/channel/${OTHER_CHANNEL}`, CHANNEL],
    })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({ part: PARTS, id: `${CHANNEL},${OTHER_CHANNEL}` })
  })

  test("returns the fields named, the counts as numbers", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [channelResource(CHANNEL, { etag: "x" })] })])

    expect(await h.read({ method: "channels", channels: [CHANNEL] })).toEqual({
      channels: [
        {
          channel_id: CHANNEL,
          title: "Made-up channel",
          handle: "@madeup",
          description: "A channel about made-up things.",
          description_clipped: false,
          published_at: "2020-01-02T03:04:05Z",
          country: "JP",
          subscriber_count: 1500,
          video_count: 42,
          view_count: 99000,
          uploads_playlist_id: "UUmadeUpChannelId0123456",
          url: `https://www.youtube.com/channel/${CHANNEL}`,
        },
      ],
      not_found: [],
    })
  })

  test("a hidden subscriber count is null, and what is absent is null", async () => {
    const h = await fixture([
      answer(CHANNELS_URL, {
        items: [
          channelResource(CHANNEL, { statistics: { subscriberCount: "0", hiddenSubscriberCount: true } }),
          { id: OTHER_CHANNEL },
        ],
      }),
    ])

    const result = await h.read({ method: "channels", channels: [CHANNEL, OTHER_CHANNEL] })

    expect(result.channels?.[0]).toMatchObject({ subscriber_count: null, video_count: null, view_count: null })
    expect(result.channels?.[1]).toEqual({
      channel_id: OTHER_CHANNEL,
      title: "",
      handle: null,
      description: "",
      description_clipped: false,
      published_at: null,
      country: null,
      subscriber_count: null,
      video_count: null,
      view_count: null,
      uploads_playlist_id: null,
      url: `https://www.youtube.com/channel/${OTHER_CHANNEL}`,
    })
  })

  test("each handle takes its own call, and the channels come back in the order asked", async () => {
    const titled = (id: string, title: string) => ({ json: { items: [channelResource(id, { snippet: { title } })] } })
    const h = await fixture([
      respond(CHANNELS_URL, (request) => {
        const handle = request.url.searchParams.get("forHandle")
        if (handle === "@other") return titled(OTHER_CHANNEL, "Other")
        return handle === "@madeup" ? titled(CHANNEL, "Handled") : titled(CHANNEL, "By id")
      }),
    ])

    const result = await h.read({
      method: "channels",
      channels: ["@madeup", CHANNEL, "https://www.youtube.com/@other"],
    })

    expect(h.calls().map(requestLine)).toHaveLength(3)
    expect(queryOf(h, 0)).toEqual({ part: PARTS, id: CHANNEL })
    expect(queryOf(h, 1)).toEqual({ part: PARTS, forHandle: "@madeup" })
    expect(queryOf(h, 2)).toEqual({ part: PARTS, forHandle: "@other" })
    expect(result.channels?.map((channel) => channel.title)).toEqual(["Handled", "By id", "Other"])
  })

  test("a handle given twice, in any case, is looked up once", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [channelResource()] })])

    await h.read({ method: "channels", channels: ["@MadeUp", "@madeup"] })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({ part: PARTS, forHandle: "@MadeUp" })
  })

  test("names the values given that no channel matches, as given", async () => {
    const h = await fixture([
      respond(CHANNELS_URL, (request) =>
        request.url.searchParams.has("forHandle")
          ? { json: {} }
          : { json: { items: [channelResource(OTHER_CHANNEL)] } },
      ),
    ])

    const result = await h.read({
      method: "channels",
      channels: ["https://www.youtube.com/@nobody", CHANNEL, OTHER_CHANNEL],
    })

    expect(result.channels?.map((channel) => channel.channel_id)).toEqual([OTHER_CHANNEL])
    expect(result.not_found).toEqual(["https://www.youtube.com/@nobody", CHANNEL])
  })

  test("a description of more than 2000 characters is clipped and says so", async () => {
    const h = await fixture([
      answer(CHANNELS_URL, {
        items: [channelResource(CHANNEL, { snippet: { title: "t", description: "y".repeat(2001) } })],
      }),
    ])

    const [channel] = (await h.read({ method: "channels", channels: [CHANNEL] })).channels!

    expect(channel).toMatchObject({ description: "y".repeat(2000), description_clipped: true })
  })

  test.each([
    ["no channels", { channels: [] }],
    ["a handle that is too short", { channels: ["@ab"] }],
    ["a video id", { channels: ["abcDEFghi_1"] }],
    ["one bad value among good ones", { channels: [CHANNEL, "nobody"] }],
  ])("%s is invalid_argument, and sends nothing", async (_name, args) => {
    const h = await fixture([])

    await expect(h.read({ method: "channels", ...args })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
