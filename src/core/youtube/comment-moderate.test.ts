import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  COMMENTS_URL,
  COMMENT_THREADS_URL,
  OTHER_THREAD,
  OTHER_VIDEO,
  REPLY,
  THREAD,
  VIDEO,
  cleanUp,
  commentsHandler,
  freshTokens,
  replyComment,
  topComment,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const MODERATE_URL = `${COMMENTS_URL}/setModerationStatus`

describe("google_youtube_comment_moderate", () => {
  test("reads the comments, the channel and the videos, then sends one POST that publishes them", async () => {
    const h = await writeFixture()

    const result = await h.commentModerate.run()

    expect(h.lines()).toEqual([
      `GET ${COMMENTS_URL}`,
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `POST ${MODERATE_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({
      part: "snippet",
      id: THREAD,
      textFormat: "plainText",
    })
    expect(Object.fromEntries(h.calls()[2]!.url.searchParams)).toEqual({ part: "snippet,status", id: VIDEO })
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ id: THREAD, moderationStatus: "published" })
    expect(post!.body).toBeUndefined()
    expect(result).toEqual({ comments: [THREAD], moderation: "published", videos: [VIDEO] })
  })

  test("holds comments for review", async () => {
    const h = await writeFixture()

    const result = await h.commentModerate.run({ moderation: "hold" })

    expect(Object.fromEntries(h.writes()[0]!.url.searchParams)).toEqual({
      id: THREAD,
      moderationStatus: "heldForReview",
    })
    expect(result.moderation).toBe("heldForReview")
  })

  test("sends the ids of several comments in one call, each once", async () => {
    const h = await writeFixture()

    const result = await h.commentModerate.run({ comments: [OTHER_THREAD, THREAD, OTHER_THREAD] })

    expect(h.writes()).toHaveLength(1)
    expect(h.writes()[0]!.url.searchParams.get("id")).toBe(`${OTHER_THREAD},${THREAD}`)
    expect(result.comments).toEqual([OTHER_THREAD, THREAD])
  })

  test("takes 50 comments", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `UgxMadeUp${String(index).padStart(3, "0")}`)
    const h = await writeFixture({ handlers: [commentsHandler(...ids.map((id) => topComment(id)))] })

    await h.commentModerate.run({ comments: ids })

    expect(h.writes()[0]!.url.searchParams.get("id")).toBe(ids.join(","))
  })

  test("finds the video of a reply through its thread, once for replies of one thread", async () => {
    const sibling = `${THREAD}.MadeUpOtherRep`
    const h = await writeFixture({
      handlers: [commentsHandler(topComment(), replyComment(), replyComment(sibling, "Another."))],
    })

    const result = await h.commentModerate.run({ comments: [REPLY, THREAD, sibling] })

    expect(h.lines()).toEqual([
      `GET ${COMMENTS_URL}`,
      `GET ${COMMENT_THREADS_URL}`,
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `POST ${MODERATE_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[1]!.url.searchParams)).toEqual({
      part: "snippet",
      id: THREAD,
      textFormat: "plainText",
    })
    expect(result.videos).toEqual([VIDEO])
  })

  test("finds the video of a top-level comment through its own thread when Google gives no videoId, as it does", async () => {
    const h = await writeFixture({
      handlers: [commentsHandler(topComment(THREAD, "A made-up comment.", { videoId: undefined }))],
    })

    const result = await h.commentModerate.run({ comments: [THREAD], moderation: "hold" })

    expect(h.calls()[1]!.url.searchParams.get("id")).toBe(THREAD)
    expect(h.lines()[1]).toBe(`GET ${COMMENT_THREADS_URL}`)
    expect(result.videos).toEqual([VIDEO])
  })

  test("comments on several of the channel's videos are one call, with every video returned", async () => {
    const other = { ...writableVideo(), id: OTHER_VIDEO }
    const h = await writeFixture({
      handlers: [
        commentsHandler(topComment(THREAD), topComment(OTHER_THREAD, "Elsewhere.", { videoId: OTHER_VIDEO })),
        videoHandler(writableVideo(), other),
      ],
    })

    const result = await h.commentModerate.run({ comments: [OTHER_THREAD, THREAD] })

    expect(h.calls()[2]!.url.searchParams.get("id")).toBe(`${OTHER_VIDEO},${VIDEO}`)
    expect(result).toEqual({ comments: [OTHER_THREAD, THREAD], moderation: "published", videos: [OTHER_VIDEO, VIDEO] })
  })

  test("the targets are each comment on its video, a reply under its own id", async () => {
    const h = await writeFixture()

    expect(await h.commentModerate.targets({ comments: [THREAD, REPLY] })).toEqual([
      `work/videos/${VIDEO}/comments/${THREAD}`,
      `work/videos/${VIDEO}/comments/${REPLY}`,
    ])
  })

  test("the target is * when Google cannot tell, and nothing is sent", async () => {
    const h = await writeFixture()

    expect(await h.commentModerate.targets({ comments: ["UgxNoSuchComment"] })).toEqual(["*"])
    expect(h.writes()).toEqual([])
  })
})
