import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CHANNEL,
  OTHER_VIDEO,
  VIDEO,
  VIDEOS_URL,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  videoResource,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_read videos", () => {
  test("reads the videos in one call, ids and addresses alike, none twice", async () => {
    const h = await fixture([answer(VIDEOS_URL, { items: [videoResource(VIDEO), videoResource(OTHER_VIDEO)] })])

    await h.read({
      method: "videos",
      videos: [VIDEO, `https://www.youtube.com/watch?v=${OTHER_VIDEO}`, `https://youtu.be/${VIDEO}`],
    })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({
      part: "snippet,contentDetails,statistics,status",
      id: `${VIDEO},${OTHER_VIDEO}`,
    })
  })

  test("returns the fields named, the counts as numbers", async () => {
    const h = await fixture([
      answer(VIDEOS_URL, { items: [videoResource(VIDEO, { etag: "x", kind: "youtube#video" })] }),
    ])

    expect(await h.read({ method: "videos", videos: [VIDEO] })).toEqual({
      videos: [
        {
          video_id: VIDEO,
          title: "A made-up video",
          channel_id: CHANNEL,
          channel_title: "Made-up channel",
          published_at: "2026-03-01T09:00:00Z",
          description: "About made-up things.",
          description_clipped: false,
          tags: ["made", "up"],
          duration: "PT4M13S",
          live: "none",
          privacy: "public",
          made_for_kids: false,
          view_count: 1200,
          like_count: 34,
          comment_count: 5,
          url: `https://www.youtube.com/watch?v=${VIDEO}`,
        },
      ],
      not_found: [],
    })
  })

  test("a hidden or absent count is null, and what is absent is empty or null", async () => {
    const h = await fixture([
      answer(VIDEOS_URL, {
        items: [
          { id: VIDEO, statistics: { viewCount: "7" } },
          videoResource(OTHER_VIDEO, { statistics: { viewCount: "many", likeCount: "-1" } }),
        ],
      }),
    ])

    const result = await h.read({ method: "videos", videos: [VIDEO, OTHER_VIDEO] })

    expect(result.videos?.[0]).toEqual({
      video_id: VIDEO,
      title: "",
      channel_id: null,
      channel_title: null,
      published_at: null,
      description: "",
      description_clipped: false,
      tags: [],
      duration: null,
      live: null,
      privacy: null,
      made_for_kids: null,
      view_count: 7,
      like_count: null,
      comment_count: null,
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
    })
    expect(result.videos?.[1]).toMatchObject({ view_count: null, like_count: null, comment_count: null })
  })

  test("comes back in the order asked, and names the ids Google did not return", async () => {
    const h = await fixture([answer(VIDEOS_URL, { items: [videoResource(OTHER_VIDEO), videoResource(VIDEO)] })])

    const result = await h.read({ method: "videos", videos: [VIDEO, "missingVid1", OTHER_VIDEO] })

    expect(result.videos?.map((video) => video.video_id)).toEqual([VIDEO, OTHER_VIDEO])
    expect(result.not_found).toEqual(["missingVid1"])
  })

  test("all ids unknown is an empty answer, not an error", async () => {
    const h = await fixture([answer(VIDEOS_URL, { kind: "youtube#videoListResponse" })])

    expect(await h.read({ method: "videos", videos: [VIDEO] })).toEqual({ videos: [], not_found: [VIDEO] })
  })

  test("a description of more than 2000 characters is clipped and says so", async () => {
    const snippet = { title: "t", description: "x".repeat(2001) }
    const h = await fixture([answer(VIDEOS_URL, { items: [{ id: VIDEO, snippet }] })])

    const [video] = (await h.read({ method: "videos", videos: [VIDEO] })).videos!

    expect(video).toMatchObject({ description: "x".repeat(2000), description_clipped: true })
  })

  test("fifty videos are allowed, fifty-one are not", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `abcdefghi${String(index).padStart(2, "0")}`)
    const h = await fixture([answer(VIDEOS_URL, { items: [] })])

    await expect(h.read({ method: "videos", videos: ids })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
    await h.read({ method: "videos", videos: ids.slice(0, 50) })
    expect(queryOf(h).id?.split(",")).toHaveLength(50)
  })

  test.each([
    ["no videos", { videos: [] }],
    ["a value that is no video", { videos: ["short"] }],
    ["a channel address", { videos: [`https://www.youtube.com/channel/${CHANNEL}`] }],
    ["one bad value among good ones", { videos: [VIDEO, "https://example.test/watch?v=abcDEFghi_1"] }],
  ])("%s is invalid_argument, and sends nothing", async (_name, args) => {
    const h = await fixture([])

    await expect(h.read({ method: "videos", ...args })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
