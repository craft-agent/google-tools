import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  ITEM,
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_ITEMS_URL,
  READ_ONLY_CREDENTIAL,
  UPLOADS,
  VIDEO,
  cleanUp,
  entryDeleteHandler,
  freshTokens,
  playlistEntriesHandler,
  playlistEntry,
  playlistHandler,
  refusal,
  writablePlaylist,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_playlist_remove", () => {
  test("sends one DELETE of the entry's id alone, after reading the channel, the playlist and the entry", async () => {
    const h = await writeFixture()

    await h.playlistRemove.run()

    expect(h.lines()).toEqual([
      `GET ${CHANNELS_URL}`,
      `GET ${PLAYLISTS_URL}`,
      `GET ${PLAYLIST_ITEMS_URL}`,
      `DELETE ${PLAYLIST_ITEMS_URL}`,
    ])
    const [del] = h.writes()
    expect(Object.fromEntries(del!.url.searchParams)).toEqual({ id: ITEM })
    expect(del!.body).toBeUndefined()
  })

  test("returns what was removed, and says that only the entry was", async () => {
    const h = await writeFixture()

    expect(await h.playlistRemove.run()).toEqual({
      playlist_item_id: ITEM,
      playlist_id: PLAYLIST,
      video_id: VIDEO,
      position: 1,
      note: "Only the entry was removed; the video itself is unchanged.",
    })
  })

  test("returns a position null when Google gave none", async () => {
    const entry = playlistEntry(ITEM, { snippet: { position: undefined } })
    const h = await writeFixture({ handlers: [playlistEntriesHandler(entry)] })

    expect((await h.playlistRemove.run()).position).toBeNull()
  })

  test("the target is the playlist of the label", async () => {
    const h = await writeFixture()

    expect(await h.playlistRemove.targets()).toEqual([`work/playlists/${PLAYLIST}`])
  })
})

describe("google_youtube_playlist_remove: an entry that is not the channel's to remove", () => {
  test("a playlist of another channel is forbidden, sending nothing and reading no entry", async () => {
    const other = writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } })
    const h = await writeFixture({ handlers: [playlistHandler(other)] })

    const error = await toolError(h.playlistRemove.run())

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
    expect(h.lines()).not.toContain(`GET ${PLAYLIST_ITEMS_URL}`)
  })

  test("the uploads playlist is forbidden, sending nothing", async () => {
    const h = await writeFixture({ handlers: [playlistHandler({ ...writablePlaylist(), id: UPLOADS })] })

    const error = await toolError(h.playlistRemove.run({ playlist: UPLOADS }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a playlist Google does not return is not_found", async () => {
    const h = await writeFixture()

    expect((await toolError(h.playlistRemove.run({ playlist: "PLnoSuchPlaylist001" }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("an entry Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistRemove.run({ item: "UExtbm9TdWNoRW50cnk" }))

    expect(error.code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("an entry of another playlist is not_found, sending nothing", async () => {
    const elsewhere = playlistEntry(ITEM, { snippet: { playlistId: "PLotherMadeUpPlay01" } })
    const h = await writeFixture({ handlers: [playlistEntriesHandler(elsewhere)] })

    const error = await toolError(h.playlistRemove.run())

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(`is not an entry of playlist ${PLAYLIST}`)
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistRemove.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_remove: a call that cannot be", () => {
  test.each([
    ["an entry that is no entry id", { item: "short" }],
    ["an entry id with a slash", { item: "UExtYWRlVXBF/bnRyeTA" }],
    ["a playlist that is no playlist id", { playlist: "a/b" }],
  ])("%s is invalid_argument before any request", async (_name, args) => {
    const h = await writeFixture()

    expect((await toolError(h.playlistRemove.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_remove: Google's refusals", () => {
  test.each([
    ["playlistItemNotFound", 404, "not_found"],
    ["playlistItemsNotAccessible", 403, "forbidden"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [entryDeleteHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistRemove.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })
})
