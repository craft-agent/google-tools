import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  CHANNELS_URL,
  NEW_ITEM,
  OTHER_CHANNEL,
  OTHER_VIDEO,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_ITEMS_URL,
  READ_ONLY_CREDENTIAL,
  UPLOADS,
  VIDEO,
  VIDEOS_URL,
  cleanUp,
  entryInsertHandler,
  freshTokens,
  playlistHandler,
  refusal,
  videoHandler,
  videoReplyHandler,
  writablePlaylist,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const RESOURCE = { kind: "youtube#video", videoId: VIDEO }

describe("google_youtube_playlist_add", () => {
  test("sends one POST of the entry, after reading the channel, the playlist and the video", async () => {
    const h = await writeFixture()

    await h.playlistAdd.run()

    expect(h.lines()).toEqual([
      `GET ${CHANNELS_URL}`,
      `GET ${PLAYLISTS_URL}`,
      `GET ${VIDEOS_URL}`,
      `POST ${PLAYLIST_ITEMS_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[2]!.url.searchParams)).toEqual({ part: "snippet,status", id: VIDEO })
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ part: "snippet" })
    expect(post!.json).toEqual({ snippet: { playlistId: PLAYLIST, resourceId: RESOURCE } })
  })

  test("sends the position, 0 too, and the note as given", async () => {
    const h = await writeFixture()

    await h.playlistAdd.run({ position: 0, note: "Start here" })

    const [post] = h.writes()
    expect(post!.url.searchParams.get("part")).toBe("snippet,contentDetails")
    expect(post!.json).toEqual({
      snippet: { playlistId: PLAYLIST, resourceId: RESOURCE, position: 0 },
      contentDetails: { note: "Start here" },
    })
  })

  test("returns the new entry as Google reports it", async () => {
    const h = await writeFixture()

    expect(await h.playlistAdd.run()).toEqual({
      playlist_item_id: NEW_ITEM,
      playlist_id: PLAYLIST,
      video_id: VIDEO,
      position: 3,
    })
    expect(await h.playlistAdd.run({ position: 0 })).toMatchObject({ position: 0 })
  })

  test("returns a position null when Google reports none, and the ids it was given when Google leaves them out", async () => {
    const h = await writeFixture({ handlers: [entryInsertHandler({ json: { id: NEW_ITEM } })] })

    expect(await h.playlistAdd.run()).toEqual({
      playlist_item_id: NEW_ITEM,
      playlist_id: PLAYLIST,
      video_id: VIDEO,
      position: null,
    })
  })

  test("takes the video as an address, and any channel's video", async () => {
    const other = writableVideo({ snippet: { channelId: OTHER_CHANNEL } })
    const h = await writeFixture({ handlers: [videoHandler({ ...other, id: OTHER_VIDEO })] })

    const result = await h.playlistAdd.run({ video: `https://youtu.be/${OTHER_VIDEO}` })

    expect(result.video_id).toBe(OTHER_VIDEO)
    expect(h.writes()[0]!.json).toMatchObject({ snippet: { resourceId: { videoId: OTHER_VIDEO } } })
  })

  test("takes the playlist as an address, and the target is the playlist of the label", async () => {
    const h = await writeFixture()

    await h.playlistAdd.run({ playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}` })

    expect(h.writes()[0]!.json).toMatchObject({ snippet: { playlistId: PLAYLIST } })
    expect(await h.playlistAdd.targets()).toEqual([`work/playlists/${PLAYLIST}`])
  })
})

describe("google_youtube_playlist_add: a playlist or a video that is not to be added to", () => {
  test("a playlist of another channel is forbidden, sending nothing and reading no video", async () => {
    const other = writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } })
    const h = await writeFixture({ handlers: [playlistHandler(other)] })

    const error = await toolError(h.playlistAdd.run())

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
    expect(h.lines()).not.toContain(`GET ${VIDEOS_URL}`)
  })

  test("the uploads playlist is forbidden, sending nothing", async () => {
    const h = await writeFixture({ handlers: [playlistHandler({ ...writablePlaylist(), id: UPLOADS })] })

    const error = await toolError(h.playlistAdd.run({ playlist: UPLOADS }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("uploads playlist")
    expect(h.writes()).toEqual([])
  })

  test("a playlist Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.playlistAdd.run({ playlist: "PLnoSuchPlaylist001" }))

    expect(error.code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return is not_found, naming it", async () => {
    const h = await writeFixture({ handlers: [videoReplyHandler({ json: { items: [] } })] })

    const error = await toolError(h.playlistAdd.run())

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(VIDEO)
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.playlistAdd.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_playlist_add: a call that cannot be", () => {
  test.each([
    ["a note of 281 characters", { note: "あ".repeat(281) }, "at most 280 characters, not 281"],
    ["a negative position", { position: -1 }, ""],
    ["a position that is no whole number", { position: 1.5 }, ""],
    ["a position that is no number", { position: "first" }, ""],
    ["a video that is no video id", { video: "short" }, "is not a video id"],
    ["a playlist that is no playlist id", { playlist: "a/b" }, "is not a playlist id"],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.playlistAdd.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test("a note of 280 characters is sent", async () => {
    const h = await writeFixture()

    await h.playlistAdd.run({ note: "あ".repeat(280) })

    expect(h.writes()).toHaveLength(1)
  })
})

describe("google_youtube_playlist_add: Google's refusals", () => {
  test.each([
    ["manualSortRequired", 400, "invalid_argument"],
    ["playlistContainsMaximumNumberOfVideos", 409, "invalid_argument"],
    ["videoAlreadyInAnotherSeriesPlaylist", 400, "invalid_argument"],
    ["invalidPlaylistSnippet", 400, "invalid_argument"],
    ["invalidContentDetails", 400, "invalid_argument"],
    ["playlistOperationUnsupported", 403, "forbidden"],
    ["playlistItemsNotAccessible", 403, "forbidden"],
    ["videoNotFound", 404, "not_found"],
    ["playlistNotFound", 404, "not_found"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [entryInsertHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.playlistAdd.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no")
  })

  test("a position in a playlist sorted automatically says where the sorting is set", async () => {
    const h = await writeFixture({ handlers: [entryInsertHandler(refusal(400, "manualSortRequired", "Sorted."))] })

    const error = await toolError(h.playlistAdd.run({ position: 0 }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("sorted automatically")
    expect(error.message).toContain("YouTube Studio")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [entryInsertHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.playlistAdd.run())

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
