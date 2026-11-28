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
  entryUpdateHandler,
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

const RESOURCE = { kind: "youtube#video", videoId: VIDEO }

describe("google_youtube_playlist_move", () => {
  test("sends one PUT of the entry, whole as read with the new position, after reading the channel, the playlist and the entry", async () => {
    const h = await writeFixture()

    await h.playlistMove.run({ position: 0 })

    expect(h.lines()).toEqual([
      `GET ${CHANNELS_URL}`,
      `GET ${PLAYLISTS_URL}`,
      `GET ${PLAYLIST_ITEMS_URL}`,
      `PUT ${PLAYLIST_ITEMS_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[2]!.url.searchParams)).toEqual({ part: "snippet,contentDetails", id: ITEM })
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "snippet" })
    expect(put!.json).toEqual({
      id: ITEM,
      snippet: { playlistId: PLAYLIST, resourceId: RESOURCE, position: 0 },
    })
  })

  test("sends the note the entry has back with it, since an update deletes what it leaves out", async () => {
    const noted = playlistEntry(ITEM, { contentDetails: { note: "Keep me" } })
    const h = await writeFixture({ handlers: [playlistEntriesHandler(noted)] })

    await h.playlistMove.run({ position: 2 })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("snippet,contentDetails")
    expect(put!.json).toEqual({
      id: ITEM,
      snippet: { playlistId: PLAYLIST, resourceId: RESOURCE, position: 2 },
      contentDetails: { note: "Keep me" },
    })
  })

  test("moves to a later position too", async () => {
    const h = await writeFixture()

    await h.playlistMove.run({ position: 5 })

    expect(h.writes()[0]!.json).toMatchObject({ snippet: { position: 5 } })
  })

  test("returns where the entry was and where Google reports it now", async () => {
    const reply = { json: { id: ITEM, snippet: { position: 2 } } }
    const h = await writeFixture({ handlers: [entryUpdateHandler(reply)] })

    expect(await h.playlistMove.run({ position: 4 })).toEqual({
      playlist_item_id: ITEM,
      playlist_id: PLAYLIST,
      video_id: VIDEO,
      before: { position: 1 },
      after: { position: 2 },
    })
  })

  test("returns a position null when Google reports none", async () => {
    const h = await writeFixture({ handlers: [entryUpdateHandler({ json: { id: ITEM } })] })

    expect((await h.playlistMove.run({ position: 0 })).after).toEqual({ position: null })
  })

  test("the target is the playlist of the label", async () => {
    const h = await writeFixture()

    expect(await h.playlistMove.targets()).toEqual([`work/playlists/${PLAYLIST}`])
  })
})

describe("google_youtube_playlist_move: an entry that is not the channel's to move", () => {
  test("a playlist of another channel is forbidden, sending nothing and reading no entry", async () => {
    const other = writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } })
    const h = await writeFixture({ handlers: [playlistHandler(other)] })

    const error = await toolError(h.playlistMove.run())

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
    expect(h.lines()).not.toContain(`GET ${PLAYLIST_ITEMS_URL}`)
  })

  test("the uploads playlist is forbidden, sending nothing", async () => {
    const h = await writeFixture({ handlers: [playlistHandler({ ...writablePlaylist(), id: UPLOADS })] })

    const error = await toolError(h.playlistMove.run({ playlist: UPLOADS }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("an entry Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistMove.run({ item: "UExtbm9TdWNoRW50cnk" }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("is not an entry of playlist")
    expect(h.writes()).toEqual([])
  })

  test("an entry of another playlist is not_found, sending nothing", async () => {
    const elsewhere = playlistEntry(ITEM, { snippet: { playlistId: "PLotherMadeUpPlay01" } })
    const h = await writeFixture({ handlers: [playlistEntriesHandler(elsewhere)] })

    const error = await toolError(h.playlistMove.run())

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(`is not an entry of playlist ${PLAYLIST}`)
    expect(h.writes()).toEqual([])
  })

  test("an entry Google gives no video for is an upstream_error", async () => {
    const bare = { id: ITEM, snippet: { playlistId: PLAYLIST, position: 1 } }
    const h = await writeFixture({ handlers: [playlistEntriesHandler(bare)] })

    expect((await toolError(h.playlistMove.run())).code).toBe("upstream_error")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistMove.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_move: a call that cannot be", () => {
  test("the position the entry is at is invalid_argument, sending nothing", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistMove.run({ position: 1 }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already at position 1")
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a negative position", { position: -1 }],
    ["a position that is no whole number", { position: 0.5 }],
    ["a position that is no number", { position: "0" }],
    ["no position", { position: undefined }],
    ["an entry that is no entry id", { item: "short" }],
    ["an entry id with a slash", { item: "UExtYWRlVXBF/bnRyeTA" }],
    ["a playlist that is no playlist id", { playlist: "a/b" }],
  ])("%s is invalid_argument before any request", async (_name, args) => {
    const h = await writeFixture()

    expect((await toolError(h.playlistMove.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_move: Google's refusals", () => {
  test.each([
    ["manualSortRequired", 400, "invalid_argument"],
    ["invalidPlaylistSnippet", 400, "invalid_argument"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["playlistItemNotFound", 404, "not_found"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [entryUpdateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistMove.run({ position: 0 }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no")
  })

  test("a position in a playlist sorted automatically says where the sorting is set", async () => {
    const h = await writeFixture({ handlers: [entryUpdateHandler(refusal(400, "manualSortRequired", "Sorted."))] })

    const error = await toolError(h.playlistMove.run({ position: 0 }))

    expect(error.message).toContain("sorted automatically")
    expect(error.message).toContain("YouTube Studio")
  })
})
