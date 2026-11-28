import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  CHANNEL,
  READ_ONLY_CREDENTIAL,
  channelHandler,
  channelUpdateHandler,
  cleanUp,
  freshTokens,
  refusal,
  respond,
  writableChannel,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_channel_edit: a call that cannot be", () => {
  test("no change is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.channelEdit.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("at least one")
    expect(h.requests).toEqual([])
  })

  test("a call that leaves every value as it is is invalid_argument, sending nothing", async () => {
    const noTrailer = writableChannel({ channel: { unsubscribedTrailer: undefined } })
    const h = await writeFixture({ handlers: [channelHandler(CHANNEL, noTrailer)] })

    const error = await toolError(
      h.channelEdit.run({
        description: "A channel about made-up things.",
        add_keywords: ["made"],
        remove_keywords: ["absent"],
        country: "jp",
        default_language: "ja",
        trailer: "",
      }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already has these values")
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a description of 1001 characters", { description: "a".repeat(1001) }, "at most 1000 characters, not 1001"],
    ["a description with markup", { description: "a > b" }, "must not hold"],
    ["a keyword with a double quote", { add_keywords: ['a"b'] }, "must not hold"],
    ["a blank keyword to add", { add_keywords: [" "] }, "blank keyword"],
    ["a blank keyword to remove", { remove_keywords: [""] }, "blank keyword"],
    ["a keyword with a space at its end", { add_keywords: ["made "] }, "must not start or end with a space"],
    ["a keyword added and removed", { add_keywords: ["a"], remove_keywords: ["a"] }, "both added and removed"],
    ["a country of three letters", { country: "JPN" }, "two-letter country code"],
    ["a default language that is no language tag", { default_language: "no way" }, "language tag"],
    ["a trailer that is no video", { trailer: "not a video" }, "is not a video id"],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.channelEdit.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test("keywords that come to more than 500 characters are invalid_argument, sending nothing", async () => {
    const h = await writeFixture()
    const keywords = Array.from({ length: 6 }, (_, index) => `${"k".repeat(99)}${index}`)

    const error = await toolError(h.channelEdit.run({ add_keywords: keywords }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("as Google counts them")
    expect(h.writes()).toEqual([])
  })

  test("keywords that come to exactly 500 characters are sent", async () => {
    const h = await writeFixture({
      handlers: [channelHandler(CHANNEL, writableChannel({ channel: { keywords: "" } }))],
    })
    const keywords = ["a".repeat(250), `${"b ".repeat(123)}b`]

    await h.channelEdit.run({ add_keywords: keywords })

    expect(h.writes()).toHaveLength(1)
  })

  test("localizations are no argument: the schema refuses them before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.channelEdit.run({ set_localizations: { fr: { title: "Une chaîne" } } }))

    expect(error.code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_channel_edit: the label", () => {
  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.channelEdit.run({ description: "x" }))).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("an account with no channel is not_found", async () => {
    const h = await writeFixture({ handlers: [respond(CHANNELS_URL, { json: {} })] })

    const error = await toolError(h.channelEdit.run({ description: "x" }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("no YouTube channel")
    expect(h.writes()).toEqual([])
  })

  test("a channel Google gives no name for is an upstream_error", async () => {
    const h = await writeFixture({ handlers: [channelHandler(CHANNEL, { id: CHANNEL })] })

    expect((await toolError(h.channelEdit.run({ description: "x" }))).code).toBe("upstream_error")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_channel_edit: Google's refusals", () => {
  test.each([
    ["channelTitleUpdateForbidden", 400, "invalid_argument"],
    ["invalidBrandingOption", 400, "invalid_argument"],
    ["brandingValidationError", 400, "invalid_argument"],
    ["channelNotFound", 404, "not_found"],
    ["forbidden", 403, "forbidden"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [channelUpdateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.channelEdit.run({ description: "New words." }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [channelUpdateHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.channelEdit.run({ description: "New words." }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
