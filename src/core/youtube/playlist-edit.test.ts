import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_TITLE,
  READ_ONLY_CREDENTIAL,
  UPLOADS,
  cleanUp,
  freshTokens,
  playlistHandler,
  playlistUpdateHandler,
  refusal,
  writablePlaylist,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const READS = [`GET ${CHANNELS_URL}`, `GET ${PLAYLISTS_URL}`]

/** The whole snippet of the made-up playlist, as an update sends it back. */
const SNIPPET = { title: PLAYLIST_TITLE, description: "About made-up things.", defaultLanguage: "en" }

const JA = { title: "作り話の再生リスト", description: "作り話です。" }

describe("google_youtube_playlist_edit", () => {
  test("sends one PUT of the snippet alone, whole as read with the title changed", async () => {
    const h = await writeFixture()

    await h.playlistEdit.run({ title: "New title" })

    expect(h.lines()).toEqual([...READS, `PUT ${PLAYLISTS_URL}`])
    expect(h.calls()[0]!.url.searchParams.get("part")).toBe("contentDetails")
    expect(Object.fromEntries(h.calls()[1]!.url.searchParams)).toEqual({
      part: "snippet,status,localizations,contentDetails",
      id: PLAYLIST,
    })
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "snippet" })
    expect(put!.json).toEqual({ id: PLAYLIST, snippet: { ...SNIPPET, title: "New title" } })
  })

  test("never sends the status or the entry count", async () => {
    const h = await writeFixture()

    await h.playlistEdit.run({ description: "", default_language: "ja" })

    const [put] = h.writes()
    expect(put!.json).toEqual({ id: PLAYLIST, snippet: { ...SNIPPET, description: "", defaultLanguage: "ja" } })
    expect(put!.body).not.toContain("status")
    expect(put!.body).not.toContain("contentDetails")
  })

  test("sends the localizations alone, whole, each language set merged over its entry", async () => {
    const h = await writeFixture()

    const result = await h.playlistEdit.run({
      set_localizations: { ja: { description: "新しい説明。" }, fr: { title: "Un voyage" } },
    })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("localizations")
    expect(put!.json).toEqual({
      id: PLAYLIST,
      localizations: { ja: { ...JA, description: "新しい説明。" }, fr: { title: "Un voyage" } },
    })
    expect(result.changed).toEqual([
      { field: "localization ja", before: JA, after: { ...JA, description: "新しい説明。" } },
      { field: "localization fr", before: null, after: { title: "Un voyage", description: "" } },
    ])
  })

  test("removes a language, sending the localizations that are left", async () => {
    const h = await writeFixture()

    const result = await h.playlistEdit.run({ remove_localizations: ["ja", "de"] })

    expect(h.writes()[0]!.json).toEqual({ id: PLAYLIST, localizations: {} })
    expect(result.changed).toEqual([{ field: "localization ja", before: JA, after: null }])
  })

  test("sends the snippet and the localizations together, in the order part lists them", async () => {
    const h = await writeFixture()

    await h.playlistEdit.run({ title: "New title", set_localizations: { ja: { title: "新タイトル" } } })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("snippet,localizations")
    expect(put!.json).toEqual({
      id: PLAYLIST,
      snippet: { ...SNIPPET, title: "New title" },
      localizations: { ja: { ...JA, title: "新タイトル" } },
    })
  })

  test("a default language in the same call lets a playlist without one have localizations", async () => {
    const bare = writablePlaylist({ snippet: { defaultLanguage: undefined }, localizations: {} })
    const h = await writeFixture({ handlers: [playlistHandler(bare)] })

    await h.playlistEdit.run({ default_language: "en", set_localizations: { ja: { title: "旅" } } })

    expect(h.writes()[0]!.json).toEqual({
      id: PLAYLIST,
      snippet: { title: PLAYLIST_TITLE, description: "About made-up things.", defaultLanguage: "en" },
      localizations: { ja: { title: "旅" } },
    })
  })

  test("a field given with the value it has is no change, and the others still go", async () => {
    const h = await writeFixture()

    const result = await h.playlistEdit.run({ title: PLAYLIST_TITLE, description: "Different." })

    expect(h.writes()[0]!.json).toEqual({ id: PLAYLIST, snippet: { ...SNIPPET, description: "Different." } })
    expect(result.changed.map(({ field }) => field)).toEqual(["description"])
  })

  test("returns what changed as Google reports it, with the privacy now", async () => {
    const reply = { json: { id: PLAYLIST, snippet: { title: "Google's title" } } }
    const h = await writeFixture({ handlers: [playlistUpdateHandler(reply)] })

    const result = await h.playlistEdit.run({ title: "New title" })

    expect(result).toEqual({
      playlist_id: PLAYLIST,
      url: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      privacy: "public",
      changed: [{ field: "title", before: PLAYLIST_TITLE, after: "Google's title" }],
    })
  })

  test("takes the playlist as an address, and the target is the playlist of the label", async () => {
    const h = await writeFixture()

    const result = await h.playlistEdit.run({
      playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      title: "New title",
    })

    expect(result.playlist_id).toBe(PLAYLIST)
    expect(await h.playlistEdit.targets({ title: "x" })).toEqual([`work/playlists/${PLAYLIST}`])
  })
})

describe("google_youtube_playlist_edit: a playlist that is not the channel's to edit", () => {
  test("a playlist of another channel is forbidden, names the playlist and sends nothing", async () => {
    const other = writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } })
    const h = await writeFixture({ handlers: [playlistHandler(other)] })

    const error = await toolError(h.playlistEdit.run({ title: "New title" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${PLAYLIST_TITLE}"`)
    expect(error.message).toContain(PLAYLIST)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("the uploads playlist is forbidden, sending nothing", async () => {
    const uploads = { ...writablePlaylist(), id: UPLOADS }
    const h = await writeFixture({ handlers: [playlistHandler(uploads)] })

    const error = await toolError(h.playlistEdit.run({ playlist: UPLOADS, title: "New title" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("uploads playlist")
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("the uploads playlist is told from the channel alone, since Google does not list it as a playlist", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistEdit.run({ playlist: UPLOADS, title: "New title" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("uploads playlist")
    expect(h.lines().filter((line) => line.includes("/playlists?"))).toEqual([])
  })

  test("a playlist Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistEdit.run({ playlist: "PLnoSuchPlaylist001", title: "New title" }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("PLnoSuchPlaylist001")
    expect(h.writes()).toEqual([])
  })

  test("a playlist Google gives no title or privacy for is an upstream_error", async () => {
    const h = await writeFixture({
      handlers: [playlistHandler({ id: PLAYLIST, snippet: { channelId: "UCmadeUpChannelId0123456" } })],
    })

    expect((await toolError(h.playlistEdit.run({ title: "New title" }))).code).toBe("upstream_error")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistEdit.run({ title: "New title" }))).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_edit: a call that cannot be", () => {
  test("no change is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistEdit.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("at least one")
    expect(h.requests).toEqual([])
  })

  test("a call that leaves every value as it is is invalid_argument, sending nothing", async () => {
    const h = await writeFixture()

    const error = await toolError(
      h.playlistEdit.run({
        title: PLAYLIST_TITLE,
        set_localizations: { ja: { title: JA.title } },
        remove_localizations: ["de"],
      }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already has these values")
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a blank title", { title: " " }, "1 to 150 characters"],
    ["a title of 151 characters", { title: "a".repeat(151) }, "1 to 150 characters, not 151"],
    ["a title with markup", { title: "<b>" }, "must not hold"],
    ["a description of 5001 characters", { description: "a".repeat(5001) }, "at most 5000 characters, not 5001"],
    ["a description with markup", { description: "a > b" }, "must not hold"],
    ["a default language that is no language tag", { default_language: "no way" }, "language tag"],
    [
      "a localization language that is no language tag",
      { set_localizations: { "no way": { title: "x" } } },
      "language tag",
    ],
    ["a removed language that is no language tag", { remove_localizations: ["no way"] }, "language tag"],
    ["a localization that sets nothing", { set_localizations: { ja: {} } }, "neither a title nor a description"],
    ["a localization title of 151 characters", { set_localizations: { ja: { title: "a".repeat(151) } } }, "1 to 150"],
    ["a localization description with markup", { set_localizations: { ja: { description: "<" } } }, "must not hold"],
    [
      "a language both set and removed",
      { set_localizations: { ja: { title: "x" } }, remove_localizations: ["ja"] },
      "both set and removed",
    ],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.playlistEdit.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test("a new language without a title is invalid_argument, sending nothing", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistEdit.run({ set_localizations: { fr: { description: "Sans titre" } } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("needs a `title`")
    expect(h.writes()).toEqual([])
  })

  test("localizations on a playlist with no default language are invalid_argument, sending nothing", async () => {
    const bare = writablePlaylist({ snippet: { defaultLanguage: undefined }, localizations: {} })
    const h = await writeFixture({ handlers: [playlistHandler(bare)] })

    const error = await toolError(h.playlistEdit.run({ set_localizations: { ja: { title: "旅" } } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("default language")
    expect(h.writes()).toEqual([])
  })

  test("a playlist that is no playlist id is invalid_argument before any request", async () => {
    const h = await writeFixture()

    expect((await toolError(h.playlistEdit.run({ playlist: "a/b", title: "x" }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_edit: Google's refusals", () => {
  test.each([
    ["invalidPlaylistSnippet", 400, "invalid_argument"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["playlistNotFound", 404, "not_found"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [playlistUpdateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistEdit.run({ title: "New title" }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [playlistUpdateHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.playlistEdit.run({ title: "New title" }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
