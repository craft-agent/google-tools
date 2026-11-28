import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeChannelEdit } from "./channel-edit"
import {
  CHANNEL,
  CHANNEL_TITLE,
  channelHandler,
  cleanUp,
  freshTokens,
  writableChannel,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(channel: unknown = writableChannel(), args: unknown = { description: "New words." }) {
  const h = await writeFixture({ handlers: [channelHandler(CHANNEL, channel)] })
  return h.channelEdit.describe(args)
}

describe("google_youtube_channel_edit describe", () => {
  test("headlines the channel's name as Google has it, not the call's", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to edit the channel {title}",
      values: { title: CHANNEL_TITLE },
    })
  })

  test("shows the fields that change and their new values, the description last", async () => {
    const description = await described(writableChannel(), {
      description: "Fresh words.",
      add_keywords: ["new one"],
      country: "us",
      default_language: "en",
      trailer: "",
    })

    expect(description.facts).toEqual([
      { label: "Fields", value: "description, keywords, country, default_language, trailer" },
    ])
    expect(description.text).toEqual({
      label: "New values",
      body: [
        "keywords: made, made up, things, new one",
        "country: US",
        "default language: en",
        "trailer: (none)",
        "description: Fresh words.",
      ].join("\n"),
    })
  })

  test("shows a description cleared to nothing", async () => {
    const description = await described(writableChannel(), { description: "" })

    expect(description.text?.body).toBe("description: ")
  })

  test("pins the channel's branding properties, not the keys an edit never changes", async () => {
    const pin = async (channel = writableChannel()) => (await described(channel)).pins
    const base = await pin()

    expect(base).toEqual({ channel: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await pin()).toEqual(base)
    expect(await pin({ ...writableChannel(), contentDetails: { relatedPlaylists: { uploads: "UUother" } } })).toEqual(
      base,
    )
    expect(await pin(writableChannel({ channel: { description: "Changed." } }))).not.toEqual(base)
    expect(await pin(writableChannel({ channel: { keywords: "other" } }))).not.toEqual(base)
    expect(await pin(writableChannel({ localizations: {} }))).toEqual(base)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubeChannelEdit, { description: "New words." }, h.ctx)

    expect(whole?.headline?.text).toBe("About to edit the channel {title}")
    expect(whole?.text?.body).toBe("description: New words.")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeChannelEdit.title]).toBeDefined()
    expect(ja[googleYoutubeChannelEdit.intent!]).toBeDefined()
    expect(ja["About to edit the channel {title}"]).toContain("{title}")
    for (const word of ["Fields", "New values"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a call with no change, and one that leaves every value as it is", async () => {
    const h = await writeFixture()

    expect((await toolError(h.channelEdit.describe())).code).toBe("invalid_argument")
    expect((await toolError(h.channelEdit.describe({ description: "A channel about made-up things." }))).code).toBe(
      "invalid_argument",
    )
  })
})
