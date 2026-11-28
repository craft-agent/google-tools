import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePlaylistAdd } from "./playlist-add"
import {
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLIST_TITLE,
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  playlistHandler,
  videoHandler,
  videoReplyHandler,
  writablePlaylist,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(args: unknown = {}, playlist: unknown = writablePlaylist(), video: unknown = writableVideo()) {
  const h = await writeFixture({ handlers: [playlistHandler(playlist), videoHandler(video)] })
  return h.playlistAdd.describe(args)
}

describe("google_youtube_playlist_add describe", () => {
  test("headlines the video's and the playlist's titles as Google has them", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to add {video} to {playlist}",
      values: { video: TITLE, playlist: PLAYLIST_TITLE },
    })
  })

  test("shows who can watch the playlist, where the entry goes and how many entries there are", async () => {
    const description = await described()

    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Position", value: { text: "the end" } },
      { label: "Entries", value: { text: "{count} entries", values: { count: 3 } } },
    ])
  })

  test("shows a position as given, 0 too, and one entry in the singular", async () => {
    const first = await described({ position: 0 }, writablePlaylist({ contentDetails: { itemCount: 1 } }))

    expect(first.facts.slice(1)).toEqual([
      { label: "Position", value: "0" },
      { label: "Entries", value: { text: "{count} entry", values: { count: 1 } } },
    ])
  })

  test("shows no entry count when Google gives none", async () => {
    const description = await described({}, writablePlaylist({ contentDetails: { itemCount: undefined } }))

    expect(description.facts.map(({ label }) => label)).toEqual(["Privacy", "Position"])
  })

  test("names the channel of a video that is not the channel's own, by its title, else its id", async () => {
    const byOther = writableVideo({ snippet: { channelId: OTHER_CHANNEL, channelTitle: "Another channel" } })
    const untitled = writableVideo({ snippet: { channelId: OTHER_CHANNEL, channelTitle: undefined } })

    expect((await described({}, writablePlaylist(), byOther)).facts.at(-1)).toEqual({
      label: "Video by",
      value: "Another channel",
    })
    expect((await described({}, writablePlaylist(), untitled)).facts.at(-1)).toEqual({
      label: "Video by",
      value: OTHER_CHANNEL,
    })
    expect((await described()).facts.map(({ label }) => label)).not.toContain("Video by")
  })

  test("shows the note as the text, and none without one", async () => {
    expect((await described({ note: "Start here" })).text).toEqual({ label: "Note", body: "Start here" })
    expect((await described()).text).toBeUndefined()
    expect((await described({ note: "" })).text).toBeUndefined()
  })

  test("pins the playlist and the video, which change when they do", async () => {
    const pins = async (playlist = writablePlaylist(), video = writableVideo()) =>
      (await described({}, playlist, video)).pins
    const base = await pins()

    expect(base).toEqual({
      playlist: expect.stringMatching(/^[0-9a-f]{64}$/),
      video: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await pins()).toEqual(base)

    const renamed = await pins(writablePlaylist({ snippet: { title: "Renamed" } }))
    expect(renamed!.playlist).not.toBe(base!.playlist)
    expect(renamed!.video).toBe(base!.video)

    for (const changed of [
      writableVideo({ snippet: { title: "Renamed" } }),
      writableVideo({ status: { privacyStatus: "private" } }),
      writableVideo({ snippet: { channelId: OTHER_CHANNEL } }),
    ]) {
      const after = await pins(undefined, changed)
      expect(after!.video).not.toBe(base!.video)
      expect(after!.playlist).toBe(base!.playlist)
    }
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubePlaylistAdd, { playlist: PLAYLIST, video: VIDEO }, h.ctx)

    expect(whole?.headline?.text).toBe("About to add {video} to {playlist}")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePlaylistAdd.title]).toBeDefined()
    expect(ja[googleYoutubePlaylistAdd.intent!]).toBeDefined()
    for (const word of ["About to add {video} to {playlist}", "{count} entry", "{count} entries"]) {
      expect(ja[word]).toBeDefined()
    }
    expect(ja["About to add {video} to {playlist}"]).toContain("{video}")
    expect(ja["About to add {video} to {playlist}"]).toContain("{playlist}")
    for (const word of ["Privacy", "Position", "the end", "Entries", "Video by", "Note"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a video that is gone, a playlist of another channel", async () => {
    const gone = await writeFixture({ handlers: [videoReplyHandler({ json: { items: [] } })] })
    expect((await toolError(gone.playlistAdd.describe())).code).toBe("not_found")

    const other = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })
    expect((await toolError(other.playlistAdd.describe())).code).toBe("forbidden")
  })
})
