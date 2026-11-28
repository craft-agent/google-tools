import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNEL,
  CHANNELS_URL,
  NEW_PLAYLIST,
  PLAYLISTS_URL,
  READ_ONLY_CREDENTIAL,
  cleanUp,
  freshTokens,
  playlistInsertHandler,
  refusal,
  respond,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_playlist_create", () => {
  test("sends one POST of the snippet and a private status, after reading the channel", async () => {
    const h = await writeFixture()

    await h.playlistCreate.run({ title: "Road trip" })

    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `POST ${PLAYLISTS_URL}`])
    expect(h.calls()[0]!.url.searchParams.get("part")).toBe("id")
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ part: "snippet,status" })
    expect(post!.json).toEqual({ snippet: { title: "Road trip" }, status: { privacyStatus: "private" } })
  })

  test("sends the description, the default language and the localizations as given, the status still private", async () => {
    const h = await writeFixture()

    await h.playlistCreate.run({
      title: "Road trip",
      description: "Songs for the car.",
      default_language: "en",
      localizations: { ja: { title: "旅", description: "車の曲。" }, "pt-BR": { title: "Viagem" } },
    })

    const [post] = h.writes()
    expect(post!.url.searchParams.get("part")).toBe("snippet,status,localizations")
    expect(post!.json).toEqual({
      snippet: { title: "Road trip", description: "Songs for the car.", defaultLanguage: "en" },
      status: { privacyStatus: "private" },
      localizations: { ja: { title: "旅", description: "車の曲。" }, "pt-BR": { title: "Viagem" } },
    })
  })

  test("returns the new playlist as Google reports it, with its address", async () => {
    const reply = {
      json: { id: NEW_PLAYLIST, snippet: { title: "Google's title" }, status: { privacyStatus: "private" } },
    }
    const h = await writeFixture({ handlers: [playlistInsertHandler(reply)] })

    const result = await h.playlistCreate.run({ title: "Road trip" })

    expect(result).toEqual({
      playlist_id: NEW_PLAYLIST,
      title: "Google's title",
      privacy: "private",
      url: `https://www.youtube.com/playlist?list=${NEW_PLAYLIST}`,
    })
  })

  test("takes the title as given when Google reports none, and reports no privacy it did not give", async () => {
    const h = await writeFixture({ handlers: [playlistInsertHandler({ json: { id: NEW_PLAYLIST } })] })

    const result = await h.playlistCreate.run({ title: "Road trip" })

    expect(result).toMatchObject({ title: "Road trip", privacy: null })
  })

  test("the target is the channel of the label", async () => {
    const h = await writeFixture()

    expect(await h.playlistCreate.targets()).toEqual([`work/channels/${CHANNEL}`])
  })

  test("the target is any when the channel cannot be told", async () => {
    const h = await writeFixture({ handlers: [respond(CHANNELS_URL, refusal(500, "backendError"))] })

    expect(await h.playlistCreate.targets()).toEqual(["*"])
  })
})

describe("google_youtube_playlist_create: a call that cannot be", () => {
  test.each([
    ["a blank title", { title: "  " }, "1 to 150 characters"],
    ["a title of 151 characters", { title: "a".repeat(151) }, "1 to 150 characters, not 151"],
    ["a title with markup", { title: "a <b> c" }, "must not hold"],
    [
      "a description of 5001 characters",
      { title: "t", description: "あ".repeat(5001) },
      "at most 5000 characters, not 5001",
    ],
    ["a description with markup", { title: "t", description: "a > b" }, "must not hold"],
    ["a default language that is no language tag", { title: "t", default_language: "english please" }, "language tag"],
    [
      "localizations with no default language",
      { title: "t", localizations: { ja: { title: "旅" } } },
      "default language",
    ],
    [
      "a localization in no language",
      { title: "t", default_language: "en", localizations: { "not a tag": { title: "x" } } },
      "language tag",
    ],
    [
      "a localization title of 151 characters",
      { title: "t", default_language: "en", localizations: { ja: { title: "a".repeat(151) } } },
      "1 to 150 characters, not 151",
    ],
    [
      "a localization description with markup",
      { title: "t", default_language: "en", localizations: { ja: { title: "x", description: "<" } } },
      "must not hold",
    ],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.playlistCreate.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test("more localizations than YouTube allows are invalid_argument before any request", async () => {
    const h = await writeFixture()
    const localizations = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`lang${i}`, { title: "t" }]))

    const error = await toolError(h.playlistCreate.run({ default_language: "en", localizations }))

    expect(error.code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistCreate.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("an account with no channel is not_found, sending nothing", async () => {
    const h = await writeFixture({ handlers: [respond(CHANNELS_URL, { json: { items: [] } })] })

    expect((await toolError(h.playlistCreate.run())).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_playlist_create: Google's refusals", () => {
  test.each([
    ["invalidPlaylistSnippet", 400, "invalid_argument"],
    ["forbidden", 403, "forbidden"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [playlistInsertHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistCreate.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [playlistInsertHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.playlistCreate.run())

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
