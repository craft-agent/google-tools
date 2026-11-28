import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePrivacySet } from "./privacy"
import {
  CHANNELS_URL,
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_TITLE,
  READ_ONLY_CREDENTIAL,
  UPLOADS,
  VIDEO,
  VIDEOS_URL,
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

/** The whole snippet of the made-up playlist, as a privacy change sends it back. */
const SNIPPET = { title: PLAYLIST_TITLE, description: "About made-up things.", defaultLanguage: "en" }

const PRIVATE_PLAYLIST = writablePlaylist({ status: { privacyStatus: "private" } })

describe("google_youtube_privacy_set with a playlist", () => {
  test("sends one PUT of the snippet, whole as read, and the status with the privacy changed", async () => {
    const h = await writeFixture()

    await h.playlistPrivacy.run({ privacy: "unlisted" })

    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `GET ${PLAYLISTS_URL}`, `PUT ${PLAYLISTS_URL}`])
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "snippet,status" })
    expect(put!.json).toEqual({ id: PLAYLIST, snippet: SNIPPET, status: { privacyStatus: "unlisted" } })
  })

  test("sends the podcast status back only when it is enabled or disabled", async () => {
    for (const [podcastStatus, sent] of [
      ["enabled", { podcastStatus: "enabled" }],
      ["disabled", { podcastStatus: "disabled" }],
      ["unspecified", {}],
    ] as const) {
      const h = await writeFixture({ handlers: [playlistHandler(writablePlaylist({ status: { podcastStatus } }))] })

      await h.playlistPrivacy.run({ privacy: "private" })

      expect(h.writes()[0]!.json).toMatchObject({ status: { privacyStatus: "private", ...sent } })
      expect((h.writes()[0]!.json as { status: object }).status).toEqual({ privacyStatus: "private", ...sent })
    }
  })

  test("makes a private playlist public, and any playlist private again", async () => {
    const h = await writeFixture({ handlers: [playlistHandler(PRIVATE_PLAYLIST)] })
    await h.playlistPrivacy.run({ privacy: "public" })
    const back = await writeFixture()
    await back.playlistPrivacy.run({ privacy: "private" })

    expect((h.writes()[0]!.json as { status: unknown }).status).toEqual({ privacyStatus: "public" })
    expect((back.writes()[0]!.json as { status: unknown }).status).toEqual({ privacyStatus: "private" })
  })

  test("returns what was asked, what it was and what Google reports, for the playlist", async () => {
    const h = await writeFixture()

    expect(await h.playlistPrivacy.run({ privacy: "unlisted" })).toEqual({
      video_id: null,
      playlist_id: PLAYLIST,
      url: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      requested: { privacy: "unlisted", publish_at: null },
      before: { privacy: "public", publish_at: null },
      after: { privacy: "unlisted", publish_at: null },
      note: null,
    })
  })

  test("says so when Google reports another privacy than was asked, and where to check", async () => {
    const reply = { json: { id: PLAYLIST, status: { privacyStatus: "private" } } }
    const h = await writeFixture({ handlers: [playlistUpdateHandler(reply)] })

    const result = await h.playlistPrivacy.run({ privacy: "unlisted" })

    expect(result.after).toEqual({ privacy: "private", publish_at: null })
    expect(result.note).toBe(
      "Google reports the playlist as private, not unlisted as asked. Check it in YouTube Studio.",
    )
  })

  test("says so when Google reports nothing of the status", async () => {
    const h = await writeFixture({ handlers: [playlistUpdateHandler({ json: { id: PLAYLIST } })] })

    const result = await h.playlistPrivacy.run({ privacy: "unlisted" })

    expect(result.after).toEqual({ privacy: null, publish_at: null })
    expect(result.note).toBe(
      "Google did not report the playlist's privacy after the change; check it in YouTube Studio.",
    )
  })

  test("takes the playlist as an address, and the target is the playlist of the label", async () => {
    const h = await writeFixture()

    const result = await h.playlistPrivacy.run({
      playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}`,
      privacy: "unlisted",
    })

    expect(result.playlist_id).toBe(PLAYLIST)
    expect(await h.playlistPrivacy.targets({ privacy: "unlisted" })).toEqual([`work/playlists/${PLAYLIST}`])
  })
})

describe("google_youtube_privacy_set: what it is of", () => {
  test.each([
    ["a playlist with a schedule", { privacy: undefined, publish_at: "2099-12-24T09:00:00+09:00" }, "has no schedule"],
    [
      "a playlist with a privacy and a schedule",
      { privacy: "public", publish_at: "2099-12-24T09:00:00+09:00" },
      "has no schedule",
    ],
    ["a playlist with no privacy", { privacy: undefined }, "Give `privacy`"],
    ["a video and a playlist", { video: VIDEO, privacy: "public" }, "exactly one of `video` and `playlist`"],
    [
      "neither a video nor a playlist",
      { playlist: undefined, privacy: "public" },
      "exactly one of `video` and `playlist`",
    ],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.playlistPrivacy.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test("a call of both or neither has no target to name", async () => {
    const h = await writeFixture()

    expect(await h.playlistPrivacy.targets({ video: VIDEO, privacy: "public" })).toEqual(["*"])
    expect(await h.playlistPrivacy.targets({ playlist: undefined, privacy: "public" })).toEqual(["*"])
  })

  test("a video is still changed as before, reading no playlist", async () => {
    const h = await writeFixture()

    const result = await h.privacy.run({ privacy: "unlisted" })

    expect(result).toMatchObject({ video_id: VIDEO, playlist_id: null })
    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `GET ${VIDEOS_URL}`, `PUT ${VIDEOS_URL}`])
  })

  test("a playlist that is no playlist id is invalid_argument before any request", async () => {
    const h = await writeFixture()

    expect((await toolError(h.playlistPrivacy.run({ playlist: "a/b", privacy: "public" }))).code).toBe(
      "invalid_argument",
    )
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_privacy_set with a playlist: one that is not the channel's to change", () => {
  test("the privacy the playlist has is invalid_argument, sending nothing", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistPrivacy.run({ privacy: "public" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already public")
    expect(h.writes()).toEqual([])
  })

  test("a playlist of another channel is forbidden, naming it and sending nothing", async () => {
    const h = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })

    const error = await toolError(h.playlistPrivacy.run({ privacy: "unlisted" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${PLAYLIST_TITLE}"`)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("the uploads playlist is forbidden, sending nothing", async () => {
    const h = await writeFixture({ handlers: [playlistHandler({ ...writablePlaylist(), id: UPLOADS })] })

    const error = await toolError(h.playlistPrivacy.run({ playlist: UPLOADS, privacy: "unlisted" }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a playlist Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistPrivacy.run({ playlist: "PLnoSuchPlaylist001", privacy: "unlisted" }))

    expect(error.code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistPrivacy.run({ privacy: "unlisted" }))).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["invalidPlaylistSnippet", 400, "invalid_argument"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["playlistNotFound", 404, "not_found"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [playlistUpdateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistPrivacy.run({ privacy: "unlisted" }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })
})

describe("google_youtube_privacy_set with a playlist: describe", () => {
  test.each([
    ["public", "About to make the playlist {title} public", PRIVATE_PLAYLIST],
    ["unlisted", "About to make the playlist {title} unlisted", PRIVATE_PLAYLIST],
    ["private", "About to make the playlist {title} private", writablePlaylist()],
  ])("headlines the playlist's title as Google has it and the privacy %s", async (privacy, text, playlist) => {
    const h = await writeFixture({ handlers: [playlistHandler(playlist)] })

    const description = await h.playlistPrivacy.describe({ privacy })

    expect(description.headline).toEqual({ text, values: { title: PLAYLIST_TITLE } })
  })

  test("shows who can watch the playlist now", async () => {
    const h = await writeFixture()

    expect((await h.playlistPrivacy.describe({ privacy: "unlisted" })).facts).toEqual([
      { label: "Now", value: { text: "public" } },
    ])
  })

  test("pins the playlist, which changes when its writable properties do", async () => {
    const pin = async (playlist = writablePlaylist()) => {
      const h = await writeFixture({ handlers: [playlistHandler(playlist)] })
      return (await h.playlistPrivacy.describe({ privacy: "private" })).pins
    }
    const base = await pin()

    expect(base).toEqual({ playlist: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await pin()).toEqual(base)
    expect(await pin(writablePlaylist({ snippet: { title: "Renamed" } }))).not.toEqual(base)
  })

  test("is a description the prompt can use, with its words in Japanese", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(
      googleYoutubePrivacySet,
      { playlist: PLAYLIST, privacy: "unlisted" },
      h.ctx,
    )

    expect(whole?.headline?.text).toBe("About to make the playlist {title} unlisted")
    const ja = ALL_TRANSLATIONS.ja!
    for (const word of [
      "About to make the playlist {title} public",
      "About to make the playlist {title} unlisted",
      "About to make the playlist {title} private",
    ]) {
      expect(ja[word]).toContain("{title}")
    }
  })

  test("throws where execute would: a playlist of another channel, a privacy it has already, a schedule", async () => {
    const other = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })
    expect((await toolError(other.playlistPrivacy.describe({ privacy: "unlisted" }))).code).toBe("forbidden")

    const h = await writeFixture()
    expect((await toolError(h.playlistPrivacy.describe({ privacy: "public" }))).code).toBe("invalid_argument")
    expect(
      (await toolError(h.playlistPrivacy.describe({ privacy: undefined, publish_at: "2099-12-24T09:00:00Z" }))).code,
    ).toBe("invalid_argument")
  })
})
