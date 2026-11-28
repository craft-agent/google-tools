import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  CHANNEL,
  CHANNEL_TITLE,
  OTHER_CHANNEL,
  OTHER_VIDEO,
  VIDEO,
  VIDEOS_URL,
  channelHandler,
  channelUpdateHandler,
  cleanUp,
  freshTokens,
  writableChannel,
  writableVideo,
  videoHandler,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The made-up channel's branding settings as Google gives them, which an edit sends back whole. */
const BRANDING = writableChannel().brandingSettings

/** The branding settings an edit sends when it sets `channel` over the made-up channel's. */
const brandingWith = (channel: Record<string, unknown>) => ({
  ...BRANDING,
  channel: { ...BRANDING.channel, ...channel },
})

describe("google_youtube_channel_edit", () => {
  test("sends one PUT of the branding settings alone, whole as read with the description changed", async () => {
    const h = await writeFixture()

    await h.channelEdit.run({ description: "New words." })

    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `PUT ${CHANNELS_URL}`])
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({
      part: "brandingSettings,snippet",
      mine: "true",
    })
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "brandingSettings" })
    expect(put!.json).toEqual({ id: CHANNEL, brandingSettings: brandingWith({ description: "New words." }) })
  })

  test("keeps the channel's name and the keys it does not know, and the keys it does not know", async () => {
    const h = await writeFixture()

    await h.channelEdit.run({ country: "us" })

    const sent = h.writes()[0]!.json as { brandingSettings: typeof BRANDING }
    expect(sent.brandingSettings.channel.title).toBe(CHANNEL_TITLE)
    expect(sent.brandingSettings.channel).toMatchObject({ trackingAnalyticsAccountId: "UA-0000000-1" })
    expect(sent.brandingSettings.image).toEqual(BRANDING.image)
    expect(sent.brandingSettings.hints).toEqual(BRANDING.hints)
  })

  test("writes the keywords as one text, a phrase in double quotes: the removed ones go, the added ones come last", async () => {
    const h = await writeFixture()

    const result = await h.channelEdit.run({ add_keywords: ["new one", "extra", "things"], remove_keywords: ["made"] })

    expect(h.writes()[0]!.json).toEqual({
      id: CHANNEL,
      brandingSettings: brandingWith({ keywords: '"made up" things "new one" extra' }),
    })
    expect(result.changed).toEqual([
      {
        field: "keywords",
        before: ["made", "made up", "things"],
        after: ["made up", "things", "new one", "extra"],
      },
    ])
  })

  test("leaves the keywords out when every one is removed", async () => {
    const h = await writeFixture()

    const result = await h.channelEdit.run({ remove_keywords: ["made", "made up", "things"] })

    const sent = h.writes()[0]!.json as { brandingSettings: { channel: Record<string, unknown> } }
    expect(sent.brandingSettings.channel).not.toHaveProperty("keywords")
    expect(result.changed).toEqual([{ field: "keywords", before: ["made", "made up", "things"], after: [] }])
  })

  test("sends the country in capitals, and takes the country and the trailer out with an empty string", async () => {
    const h = await writeFixture()

    await h.channelEdit.run({ country: "us" })
    expect(h.writes()[0]!.json).toMatchObject({ brandingSettings: { channel: { country: "US" } } })

    const removal = await writeFixture()
    const result = await removal.channelEdit.run({ country: "", trailer: "" })

    const sent = removal.writes()[0]!.json as { brandingSettings: { channel: Record<string, unknown> } }
    expect(sent.brandingSettings.channel).not.toHaveProperty("country")
    expect(sent.brandingSettings.channel).not.toHaveProperty("unsubscribedTrailer")
    expect(sent.brandingSettings.channel.title).toBe(CHANNEL_TITLE)
    expect(result.changed).toEqual([
      { field: "country", before: "JP", after: null },
      { field: "trailer", before: VIDEO, after: null },
    ])
  })

  test("sets the default language, and a trailer that is one of the channel's own videos, by address", async () => {
    const own = writableChannel({ channel: { unsubscribedTrailer: undefined } })
    const h = await writeFixture({
      handlers: [channelHandler(CHANNEL, own), videoHandler(writableVideo({ snippet: { channelId: CHANNEL } }))],
    })

    const result = await h.channelEdit.run({ default_language: "en", trailer: `https://youtu.be/${VIDEO}` })

    expect(h.lines()).toEqual([
      `GET ${CHANNELS_URL}`,
      `GET ${CHANNELS_URL}`,
      `GET ${VIDEOS_URL}`,
      `PUT ${CHANNELS_URL}`,
    ])
    expect(h.writes()[0]!.json).toMatchObject({
      brandingSettings: { channel: { defaultLanguage: "en", unsubscribedTrailer: VIDEO } },
    })
    expect(result.changed).toEqual([
      { field: "default_language", before: "ja", after: "en" },
      { field: "trailer", before: null, after: VIDEO },
    ])
  })

  test("a field given with the value it has is no change, and the others still go", async () => {
    const h = await writeFixture()

    const result = await h.channelEdit.run({ description: "A channel about made-up things.", country: "US" })

    expect(h.writes()[0]!.json).toMatchObject({ brandingSettings: { channel: { country: "US" } } })
    expect(result.changed.map(({ field }) => field)).toEqual(["country"])
  })

  test("a channel whose branding settings Google leaves out gets a channel object of the changes alone", async () => {
    const bare = { id: CHANNEL, snippet: { title: CHANNEL_TITLE } }
    const h = await writeFixture({ handlers: [channelHandler(CHANNEL, bare)] })

    await h.channelEdit.run({ description: "New words." })

    expect(h.writes()[0]!.json).toEqual({ id: CHANNEL, brandingSettings: { channel: { description: "New words." } } })
  })

  test("returns what changed as Google reports it, with the channel's address and the Studio note", async () => {
    const reply = {
      json: { id: CHANNEL, brandingSettings: { channel: { title: CHANNEL_TITLE, description: "Google's words." } } },
    }
    const h = await writeFixture({ handlers: [channelUpdateHandler(reply)] })

    const result = await h.channelEdit.run({ description: "New words." })

    expect(result).toEqual({
      channel_id: CHANNEL,
      url: `https://www.youtube.com/channel/${CHANNEL}`,
      changed: [{ field: "description", before: "A channel about made-up things.", after: "Google's words." }],
      note: "The channel's name, handle, picture, banner, links and home tab are changed in YouTube Studio.",
    })
  })

  test("a reply that is not a channel does not lose the change: the planned values stand", async () => {
    const h = await writeFixture({ handlers: [channelUpdateHandler({ json: ["not", "a", "channel"] })] })

    const result = await h.channelEdit.run({ description: "New words." })

    expect(result.changed).toEqual([
      { field: "description", before: "A channel about made-up things.", after: "New words." },
    ])
  })

  test("the target is the label's channel", async () => {
    const h = await writeFixture()

    expect(await h.channelEdit.targets({ description: "x" })).toEqual([`work/channels/${CHANNEL}`])
  })
})

describe("google_youtube_channel_edit: a trailer that is not the channel's", () => {
  test("a video of another channel is forbidden, naming the video, and nothing is sent", async () => {
    const h = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))],
    })

    const error = await toolError(h.channelEdit.run({ description: "x", trailer: VIDEO }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({ handlers: [videoHandler({ ...writableVideo(), id: OTHER_VIDEO })] })

    const error = await toolError(h.channelEdit.run({ trailer: VIDEO }))

    expect(error.code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})
