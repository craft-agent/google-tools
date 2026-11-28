import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "./scopes"
import {
  CHANNEL,
  CHANNELS_URL,
  COMMENT_THREADS_URL,
  PLAYLIST,
  PLAYLISTS_URL,
  READ_ONLY_CREDENTIAL,
  SEARCH_URL,
  THREAD,
  VIDEO,
  VIDEOS_URL,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  refusal,
  respond,
  videoResource,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CALLS = [
  ["search", { method: "search", query: "q" }, [YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE]],
  ["videos", { method: "videos", videos: [VIDEO] }, [YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE]],
  ["channels", { method: "channels", channels: [CHANNEL] }, [YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE]],
  ["playlist", { method: "playlist", playlist: PLAYLIST }, [YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE]],
  ["comments of a video", { method: "comments", video: VIDEO }, [YOUTUBE_SCOPE]],
  ["comments of a thread", { method: "comments", thread: THREAD }, [YOUTUBE_SCOPE]],
] as const

describe("google_youtube_read: the label's scopes", () => {
  test.each(CALLS)(
    "%s fails as unauthenticated, before any request, for a label without YouTube",
    async (_name, args, needs) => {
      const h = await fixture([], CREDENTIAL)

      const error = await toolError(h.read(args))

      expect(error).toMatchObject({ code: "unauthenticated" })
      expect(error.message).toContain("was not logged in with a scope this call needs")
      expect(error.message).toMatch(/login --account work --toolsets [^ ]*\byoutube\b/)
      expect(error.details?.needs).toEqual([...needs])
      expect(h.requests).toEqual([])
    },
  )

  test("a label logged in with --read-only reads public data", async () => {
    const h = await fixture([answer(VIDEOS_URL, { items: [videoResource()] })], READ_ONLY_CREDENTIAL)

    expect((await h.read({ method: "videos", videos: [VIDEO] })).videos).toHaveLength(1)
  })
})

describe("google_youtube_read: Google's refusals", () => {
  test.each(CALLS.filter(([name]) => name !== "channels" && name !== "playlist"))(
    "a spent quota is rate_limited, and %s says when it resets",
    async (_name, args) => {
      const h = await fixture([
        respond(/youtube\/v3\//, refusal(403, "quotaExceeded", "The request cannot be completed.")),
      ])

      const error = await toolError(h.read(args))

      expect(error.code).toBe("rate_limited")
      expect(error.message).toContain("The request cannot be completed.")
      expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
      expect(error.details).toEqual({ status: 403, reason: "quotaExceeded" })
    },
  )

  test("a spent quota while a playlist's items are read says so too", async () => {
    const h = await fixture([
      answer(PLAYLISTS_URL, { items: [{ id: PLAYLIST }] }),
      respond(/playlistItems/, refusal(403, "dailyLimitExceeded")),
    ])

    await expect(h.read({ method: "playlist", playlist: PLAYLIST })).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringContaining("resets at midnight Pacific time."),
    })
  })

  test("a spent quota while handles are looked up says so too", async () => {
    const h = await fixture([respond(CHANNELS_URL, refusal(429, "rateLimitExceeded"))])

    await expect(h.read({ method: "channels", channels: ["@madeup"] })).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringContaining("resets at midnight Pacific time."),
    })
  })

  test("other failures say nothing of the quota", async () => {
    const h = await fixture([respond(VIDEOS_URL, refusal(403, "forbidden", "Not allowed."))])

    const error = await toolError(h.read({ method: "videos", videos: [VIDEO] }))

    expect(error.code).toBe("forbidden")
    expect(error.message).not.toContain("quota")
  })

  test("a video whose comments are turned off is forbidden, with a plain message", async () => {
    const h = await fixture([
      respond(
        COMMENT_THREADS_URL,
        refusal(403, "commentsDisabled", "The video identified by the videoId parameter has disabled comments."),
      ),
    ])

    const error = await toolError(h.read({ method: "comments", video: VIDEO }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("Comments are turned off for this video.")
    expect(error.details).toEqual({ status: 403, reason: "commentsDisabled" })
  })

  test("HTML in Google's message is turned to plain text", async () => {
    const h = await fixture([
      respond(
        COMMENT_THREADS_URL,
        refusal(
          404,
          "videoNotFound",
          'The video identified by the <code><a href="/youtube/data/reference/rest/v3/commentThreads/list#videoId">videoId</a></code> parameter could not be found.',
        ),
      ),
    ])

    const error = await toolError(h.read({ method: "comments", video: VIDEO }))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe("Google: The video identified by the videoId parameter could not be found.")
  })

  test("a video that does not exist is not_found for its comments", async () => {
    const h = await fixture([respond(COMMENT_THREADS_URL, refusal(404, "videoNotFound", "Video not found."))])

    await expect(h.read({ method: "comments", video: VIDEO })).rejects.toMatchObject({ code: "not_found" })
  })

  test("a list whose items are not videos is upstream_error", async () => {
    const h = await fixture([answer(VIDEOS_URL, { items: [{ id: 5 }] })])

    await expect(h.read({ method: "videos", videos: [VIDEO] })).rejects.toMatchObject({
      code: "upstream_error",
      message: "Google's reply to the video list was not in the expected shape.",
    })
  })

  test("a search of a handle whose lookup is refused fails before the search", async () => {
    const h = await fixture([respond(CHANNELS_URL, refusal(403, "forbidden")), answer(SEARCH_URL, {})])

    await expect(h.read({ method: "search", channel: "@madeup" })).rejects.toMatchObject({ code: "forbidden" })
    expect(h.calls()).toHaveLength(1)
  })
})

describe("google_youtube_read: the arguments", () => {
  test.each([
    ["videos without its videos", { method: "videos" }, "Method videos needs `videos`."],
    ["channels without its channels", { method: "channels" }, "Method channels needs `channels`."],
    ["playlist without its playlist", { method: "playlist" }, "Method playlist needs `playlist`."],
    ["videos with a limit", { method: "videos", videos: [VIDEO], limit: 5 }, "Method videos takes no `limit`."],
    [
      "videos with a page token",
      { method: "videos", videos: [VIDEO], page_token: "t" },
      "Method videos takes no `page_token`.",
    ],
    [
      "channels with a query",
      { method: "channels", channels: [CHANNEL], query: "q" },
      "Method channels takes no `query`.",
    ],
    [
      "channels with videos",
      { method: "channels", channels: [CHANNEL], videos: [VIDEO] },
      "Method channels takes no `videos`.",
    ],
    [
      "comments with a playlist",
      { method: "comments", video: VIDEO, playlist: PLAYLIST },
      "Method comments takes no `playlist`.",
    ],
  ])("%s is invalid_argument, and sends nothing", async (_name, args, message) => {
    const h = await fixture([])

    await expect(h.read(args)).rejects.toMatchObject({ code: "invalid_argument", message })
    expect(h.requests).toEqual([])
  })

  test("an argument no method has, an unknown method and a bad limit are refused", async () => {
    const h = await fixture([])

    await expect(h.read({ method: "videos", videos: [VIDEO], fields: "*" })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    await expect(h.read({ method: "captions" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ method: "search", query: "q", limit: 101 })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(h.requests).toEqual([])
  })
})
