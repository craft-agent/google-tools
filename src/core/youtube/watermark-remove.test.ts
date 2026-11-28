import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeWatermarkRemove } from "./watermark-remove"
import {
  CHANNEL,
  CHANNELS_URL,
  CHANNEL_TITLE,
  READ_ONLY_CREDENTIAL,
  WATERMARKS_UNSET_URL,
  channelHandler,
  cleanUp,
  freshTokens,
  refusal,
  respond,
  watermarkUnsetHandler,
  writableChannel,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_watermark_remove", () => {
  test("posts the channel's id to the unset route with no body, and returns the channel and that it was removed", async () => {
    const h = await writeFixture()

    const result = await h.watermarkRemove.run()

    expect(result).toEqual({ channel_id: CHANNEL, removed: true })
    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `POST ${WATERMARKS_UNSET_URL}`])
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ channelId: CHANNEL })
    expect(post!.body ?? "").toBe("")
  })

  test("the target is the label's channel", async () => {
    const h = await writeFixture()

    expect(await h.watermarkRemove.targets()).toEqual([`work/channels/${CHANNEL}`])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.watermarkRemove.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("an account with no channel is not_found, posting nothing", async () => {
    const h = await writeFixture({ handlers: [respond(CHANNELS_URL, { json: {} })] })

    expect((await toolError(h.watermarkRemove.run())).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a 404 is not_found, keeps Google's message and says the channel may have no watermark", async () => {
    const h = await writeFixture({
      handlers: [watermarkUnsetHandler(refusal(404, "channelNotFound", "Channel not found."))],
    })

    const error = await toolError(h.watermarkRemove.run())

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("Channel not found.")
    expect(error.message).toEndWith(" The channel may have no watermark.")
  })

  test.each([
    ["forbidden", 403, "forbidden"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s, without the sentence about the watermark", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [watermarkUnsetHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.watermarkRemove.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
    expect(error.message).not.toContain("no watermark")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [watermarkUnsetHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.watermarkRemove.run())

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})

describe("google_youtube_watermark_remove describe", () => {
  test("headlines the channel's name as Google has it, with no facts and no text", async () => {
    const h = await writeFixture()

    const description = await h.watermarkRemove.describe()

    expect(description.headline).toEqual({
      text: "About to remove the watermark of {channel}",
      values: { channel: CHANNEL_TITLE },
    })
    expect(description.facts).toEqual([])
    expect(description.text).toBeUndefined()
  })

  test("pins the channel, and a channel that changed gives another pin", async () => {
    const h = await writeFixture()
    const base = (await h.watermarkRemove.describe()).pins

    expect(base).toEqual({ channel: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect((await h.watermarkRemove.describe()).pins).toEqual(base)

    const renamed = await writeFixture({
      handlers: [channelHandler(CHANNEL, writableChannel({ snippet: { title: "Renamed" } }))],
    })
    expect((await renamed.watermarkRemove.describe()).pins).not.toEqual(base)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubeWatermarkRemove, {}, h.ctx)

    expect(whole?.headline?.text).toBe("About to remove the watermark of {channel}")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeWatermarkRemove.title]).toBeDefined()
    expect(ja[googleYoutubeWatermarkRemove.intent!]).toBeDefined()
    expect(ja["About to remove the watermark of {channel}"]).toContain("{channel}")
  })
})
