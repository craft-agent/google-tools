import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePlaylistMove } from "./playlist-move"
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

async function described(args: unknown = {}, entry: unknown = playlistEntry(), playlist: unknown = writablePlaylist()) {
  const h = await writeFixture({
    handlers: [playlistHandler(playlist), playlistEntriesHandler(entry as { id: string })],
  })
  return h.playlistMove.describe(args)
}

describe("google_youtube_playlist_move describe", () => {
  test("headlines the entry's video title as the entry gives it and the playlist's title", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to move {video} in {playlist}",
      values: { video: TITLE, playlist: PLAYLIST_TITLE },
    })
  })

  test("shows the position the entry is at and the one it goes to", async () => {
    const description = await described({ position: 4 })

    expect(description.facts).toEqual([
      { label: "Position now", value: "1" },
      { label: "New position", value: "4" },
    ])
  })

  test("shows a position Google gave none for as unknown", async () => {
    const entry = playlistEntry(ITEM, { snippet: { position: undefined } })

    expect((await described({}, entry)).facts[0]).toEqual({ label: "Position now", value: "unknown" })
  })

  test("pins the playlist and the entry, which change when they do", async () => {
    const pins = async (entry = playlistEntry(), playlist = writablePlaylist()) =>
      (await described({}, entry, playlist)).pins
    const base = await pins()

    expect(base).toEqual({
      playlist: expect.stringMatching(/^[0-9a-f]{64}$/),
      item: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await pins()).toEqual(base)

    const renamed = await pins(undefined, writablePlaylist({ snippet: { title: "Renamed" } }))
    expect(renamed!.playlist).not.toBe(base!.playlist)
    expect(renamed!.item).toBe(base!.item)

    for (const entry of [
      playlistEntry(ITEM, { snippet: { position: 2 } }),
      playlistEntry(ITEM, { snippet: { title: "Renamed" } }),
      playlistEntry(ITEM, { contentDetails: { note: "Noted" } }),
    ]) {
      const after = await pins(entry)
      expect(after!.item).not.toBe(base!.item)
      expect(after!.playlist).toBe(base!.playlist)
    }
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(
      googleYoutubePlaylistMove,
      { playlist: PLAYLIST, item: ITEM, position: 0 },
      h.ctx,
    )

    expect(whole?.headline?.text).toBe("About to move {video} in {playlist}")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePlaylistMove.title]).toBeDefined()
    expect(ja[googleYoutubePlaylistMove.intent!]).toBeDefined()
    expect(ja["About to move {video} in {playlist}"]).toContain("{video}")
    expect(ja["About to move {video} in {playlist}"]).toContain("{playlist}")
    for (const word of ["Position now", "New position"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a playlist of another channel, an entry that is gone, a position it is at", async () => {
    const other = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })
    expect((await toolError(other.playlistMove.describe())).code).toBe("forbidden")

    const h = await writeFixture()
    expect((await toolError(h.playlistMove.describe({ item: "UExtbm9TdWNoRW50cnk" }))).code).toBe("not_found")
    expect((await toolError(h.playlistMove.describe({ position: 1 }))).code).toBe("invalid_argument")
  })
})
