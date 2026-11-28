import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  refusal,
  respond,
  videoHandler,
  videoReplyHandler,
  updateHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_video_edit: a video that is not the channel's to change", () => {
  test("another channel's video is forbidden, names the video and sends nothing", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))] })

    const error = await toolError(h.edit.run({ title: "New title" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("only the channel's own videos can be changed")
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return, and an account with no channel, are not_found", async () => {
    const gone = await writeFixture({ handlers: [videoHandler()] })
    expect((await toolError(gone.edit.run({ video: "xyzXYZ-0123", title: "New" }))).message).toBe(
      "Video xyzXYZ-0123 was not found, or the account cannot see it.",
    )

    const none = await writeFixture({ handlers: [respond(CHANNELS_URL, { json: {} })] })
    expect(await toolError(none.edit.run({ title: "New" }))).toMatchObject({ code: "not_found" })
    expect(none.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    const error = await toolError(h.edit.run({ title: "New title" }))

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("youtube.force-ssl")
    expect(h.requests).toEqual([])
  })

  test("a video that is not an id or an address is refused before any request", async () => {
    const h = await writeFixture()

    expect((await toolError(h.edit.run({ video: "nope", title: "New" }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_video_edit: an edit that cannot be", () => {
  const tags = (...lengths: number[]) => lengths.map((length, index) => String.fromCharCode(97 + index).repeat(length))
  /** `count` distinct two-letter language tags. */
  const languages = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    )

  test.each([
    ["no change", {}, "at least one"],
    ["a privacy", { title: "x", privacy: "public" }, "unknown argument"],
    ["an empty title", { title: "" }, "1 to 100 characters"],
    ["a blank title", { title: "   " }, "1 to 100 characters"],
    ["a title of 101 characters", { title: "a".repeat(101) }, "not 101"],
    ["a title with <", { title: "a < b" }, "`<` or `>`"],
    ["a description of 5001 bytes", { description: "é".repeat(2500) + "a" }, "5000 bytes in UTF-8, not 5001"],
    ["a description with >", { description: "a > b" }, "`<` or `>`"],
    ["a blank tag", { add_tags: [" "] }, "not be blank"],
    ["a tag with a comma", { add_tags: ["a,b"] }, "comma"],
    ["a tag with >", { add_tags: ["a>b"] }, "comma"],
    ["tags of 501 characters", { add_tags: tags(250, 250) }, "501 characters"],
    ["a tag with spaces counted with its quotes", { add_tags: [`${"x ".repeat(245)}x`] }, "501 characters"],
    ["a tag that makes the whole come to 501", { add_tags: tags(493) }, "501 characters"],
    ["a category of four digits", { category: "1234" }, "up to three digits"],
    ["a category that is not a number", { category: "music" }, "up to three digits"],
    ["a language that is not a tag", { default_language: "english_US" }, "language tag"],
    ["an audio language that is not a tag", { default_audio_language: "e" }, "language tag"],
    ["a license Google does not have", { license: "mit" }, "license"],
    ["a tag added and removed", { add_tags: ["x"], remove_tags: ["x"] }, "both added and removed"],
    [
      "a language set and removed",
      { set_localizations: { fr: { title: "T" } }, remove_localizations: ["fr"] },
      "both set",
    ],
    ["a localization language that is not a tag", { set_localizations: { "fr fr": { title: "T" } } }, "language tag"],
    ["a localization that sets nothing", { set_localizations: { fr: {} } }, "neither a title nor a description"],
    ["a localization title of 101 characters", { set_localizations: { fr: { title: "a".repeat(101) } } }, "`fr`"],
    ["a localization description with <", { set_localizations: { fr: { title: "T", description: "<b>" } } }, "`fr`"],
    ["a new localization with no title", { set_localizations: { fr: { description: "D" } } }, "needs a `title`"],
    ["a title that is the title it has", { title: TITLE }, "already has these values"],
    ["tags the video has and tags it lacks to remove", { add_tags: ["made"], remove_tags: ["gone"] }, "already has"],
    [
      "a localization the video has, set as it is",
      { set_localizations: { ja: { title: "作り話の動画" } } },
      "already has",
    ],
    ["a localization the video lacks, removed", { remove_localizations: ["fr"] }, "already has"],
  ])("refuses %s as invalid_argument, sending nothing", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.edit.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.writes()).toEqual([])
  })

  test("a title of 100 characters, a description of 5000 bytes, tags of 500 as Google counts them and 50 localizations are allowed", async () => {
    const h = await writeFixture()

    await h.edit.run({ title: "a".repeat(100) })
    await h.edit.run({ description: "é".repeat(2500) })
    await h.edit.run({ add_tags: tags(492) })
    await h.edit.run({ add_tags: [`${"x ".repeat(244)}xy`] })
    await h.edit.run({
      set_localizations: Object.fromEntries(languages(50).map((language) => [language, { title: "T" }])),
    })

    expect(h.writes()).toHaveLength(5)
  })

  test("51 localizations are refused", async () => {
    const h = await writeFixture()

    const error = await toolError(
      h.edit.run({
        set_localizations: Object.fromEntries(languages(51).map((language) => [language, { title: "T" }])),
      }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("at most 50")
    expect(h.writes()).toEqual([])
  })

  test("a localization needs the video's default language, the call's or its own", async () => {
    const h = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { defaultLanguage: undefined } }))],
    })

    const error = await toolError(h.edit.run({ set_localizations: { fr: { title: "T" } } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("default language")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_video_edit: Google's refusals", () => {
  test.each([
    ["invalidTitle"],
    ["invalidDescription"],
    ["invalidTags"],
    ["invalidCategoryId"],
    ["invalidPublishAt"],
    ["invalidVideoMetadata"],
  ])("a 400 %s is invalid_argument with Google's message", async (reason) => {
    const h = await writeFixture({ handlers: [updateHandler(refusal(400, reason, `Google says ${reason}.`))] })

    const error = await toolError(h.edit.run({ title: "New title" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`Google says ${reason}.`)
    expect(error.details).toEqual({ status: 400, reason })
  })

  test("another 400 stays upstream_error, and a 403 forbidden stays forbidden", async () => {
    const bad = await writeFixture({ handlers: [updateHandler(refusal(400, "badRequest", "Bad."))] })
    expect((await toolError(bad.edit.run({ title: "New title" }))).code).toBe("upstream_error")

    const denied = await writeFixture({ handlers: [updateHandler(refusal(403, "forbidden", "Not yours."))] })
    expect(await toolError(denied.edit.run({ title: "New title" }))).toMatchObject({
      code: "forbidden",
      message: "Google: Not yours.",
    })
  })

  test("a spent quota is rate_limited and says when it resets, whether the read or the update is refused", async () => {
    const update = await writeFixture({ handlers: [updateHandler(refusal(403, "quotaExceeded", "Quota."))] })
    const read = await writeFixture({ handlers: [videoReplyHandler(refusal(403, "quotaExceeded", "Quota."))] })

    for (const h of [update, read]) {
      const error = await toolError(h.edit.run({ title: "New title" }))
      expect(error.code).toBe("rate_limited")
      expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
    }
  })

  test("HTML in Google's message is turned to plain text", async () => {
    const message = 'The <a href="/x">title</a> is too long.'
    const h = await writeFixture({ handlers: [updateHandler(refusal(400, "invalidTitle", message))] })

    expect((await toolError(h.edit.run({ title: "New title" }))).message).toBe("Google: The title is too long.")
  })
})
