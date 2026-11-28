import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePlaylistRemove } from "./playlist-remove"
import {
  ITEM,
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLIST_TITLE,
  TITLE,
  cleanUp,
  freshTokens,
  playlistEntriesHandler,
  playlistEntry,
  playlistHandler,
  writablePlaylist,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(entry: unknown = playlistEntry(), playlist: unknown = writablePlaylist()) {
  const h = await writeFixture({
    handlers: [playlistHandler(playlist), playlistEntriesHandler(entry as { id: string })],
  })
  return h.playlistRemove.describe()
}

describe("google_youtube_playlist_remove describe", () => {
  test("headlines the entry's video title as the entry gives it and the playlist's title", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to remove {video} from {playlist}",
      values: { video: TITLE, playlist: PLAYLIST_TITLE },
    })
  })

  test("shows who can watch the playlist and where the entry is", async () => {
    expect((await described()).facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Position", value: "1" },
    ])
    expect(
      (await described(playlistEntry(), writablePlaylist({ status: { privacyStatus: "private" } }))).facts[0],
    ).toEqual({ label: "Privacy", value: { text: "private" } })
  })

  test("pins the playlist and the entry, which change when they do", async () => {
    const pins = async (entry = playlistEntry(), playlist = writablePlaylist()) =>
      (await described(entry, playlist)).pins
    const base = await pins()

    expect(base).toEqual({
      playlist: expect.stringMatching(/^[0-9a-f]{64}$/),
      item: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await pins()).toEqual(base)

    const moved = await pins(playlistEntry(ITEM, { snippet: { position: 2 } }))
    expect(moved!.item).not.toBe(base!.item)
    expect(moved!.playlist).toBe(base!.playlist)

    const renamed = await pins(undefined, writablePlaylist({ snippet: { title: "Renamed" } }))
    expect(renamed!.playlist).not.toBe(base!.playlist)
    expect(renamed!.item).toBe(base!.item)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubePlaylistRemove, { playlist: PLAYLIST, item: ITEM }, h.ctx)

    expect(whole?.headline?.text).toBe("About to remove {video} from {playlist}")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePlaylistRemove.title]).toBeDefined()
    expect(ja[googleYoutubePlaylistRemove.intent!]).toBeDefined()
    expect(ja["About to remove {video} from {playlist}"]).toContain("{video}")
    expect(ja["About to remove {video} from {playlist}"]).toContain("{playlist}")
  })

  test("throws where execute would: a playlist of another channel, an entry that is gone", async () => {
    const other = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })
    expect((await toolError(other.playlistRemove.describe())).code).toBe("forbidden")

    const h = await writeFixture()
    expect((await toolError(h.playlistRemove.describe({ item: "UExtbm9TdWNoRW50cnk" }))).code).toBe("not_found")
  })
})
