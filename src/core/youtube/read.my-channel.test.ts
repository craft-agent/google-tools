import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  CHANNELS_URL,
  READ_ONLY_CREDENTIAL,
  UPLOADS,
  answer,
  channelResource,
  cleanUp,
  fixture,
  freshTokens,
  myChannelResource,
  queryOf,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_read my_channel", () => {
  test("reads the channel of the label with one call, mine=true and every part", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [myChannelResource()] })])

    await h.read({ method: "my_channel" })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({
      part: "snippet,brandingSettings,status,statistics,contentDetails",
      mine: "true",
    })
  })

  test("returns the channel as a view, the keywords split with a quoted phrase as one", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [myChannelResource({ etag: "x" })] })])

    expect(await h.read({ method: "my_channel" })).toEqual({
      channel: {
        channel_id: CHANNEL,
        title: "Made-up channel",
        handle: "@madeup",
        description: "A channel about made-up things.",
        description_clipped: false,
        keywords: ["made", "made up", "things"],
        country: "JP",
        default_language: "ja",
        privacy: "public",
        made_for_kids: false,
        self_declared_made_for_kids: false,
        long_uploads: "allowed",
        subscriber_count: 1500,
        video_count: 42,
        view_count: 99000,
        uploads_playlist_id: UPLOADS,
        url: `https://www.youtube.com/channel/${CHANNEL}`,
      },
    })
  })

  test("what Google leaves out is null, and no keywords is an empty list", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [{ id: CHANNEL }] })])

    expect((await h.read({ method: "my_channel" })).channel).toEqual({
      channel_id: CHANNEL,
      title: "",
      handle: null,
      description: "",
      description_clipped: false,
      keywords: [],
      country: null,
      default_language: null,
      privacy: null,
      made_for_kids: null,
      self_declared_made_for_kids: null,
      long_uploads: null,
      subscriber_count: null,
      video_count: null,
      view_count: null,
      uploads_playlist_id: null,
      url: `https://www.youtube.com/channel/${CHANNEL}`,
    })
  })

  test("a hidden subscriber count is null, and a description of more than 2000 characters is clipped", async () => {
    const own = channelResource(CHANNEL, {
      snippet: { title: "t", description: "z".repeat(2001) },
      statistics: { subscriberCount: "10", hiddenSubscriberCount: true },
    })
    const h = await fixture([answer(CHANNELS_URL, { items: [own] })])

    expect((await h.read({ method: "my_channel" })).channel).toMatchObject({
      subscriber_count: null,
      description: "z".repeat(2000),
      description_clipped: true,
    })
  })

  test("a label logged in with --read-only reads it", async () => {
    const h = await fixture([answer(CHANNELS_URL, { items: [myChannelResource()] })], READ_ONLY_CREDENTIAL)

    expect((await h.read({ method: "my_channel" })).channel?.channel_id).toBe(CHANNEL)
  })

  test("an account with no channel is not_found, saying it reads public YouTube only", async () => {
    const h = await fixture([answer(CHANNELS_URL, {})])

    await expect(h.read({ method: "my_channel" })).rejects.toMatchObject({
      code: "not_found",
      message:
        'Google account "work" has no YouTube channel; it can read public YouTube only (search, videos, channels, playlist, comments).',
    })
  })

  test.each([
    ["a limit", { limit: 5 }, "Method my_channel takes no `limit`."],
    ["a video", { video: "abcDEFghi_1" }, "Method my_channel takes no `video`."],
    ["metrics", { metrics: "views" }, "Method my_channel takes no `metrics`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra, message) => {
    const h = await fixture([])

    await expect(h.read({ method: "my_channel", ...extra })).rejects.toMatchObject({
      code: "invalid_argument",
      message,
    })
    expect(h.requests).toEqual([])
  })
})
