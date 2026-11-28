import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  COMMENTS_URL,
  COMMENT_THREADS_URL,
  NEW_REPLY,
  OTHER_THREAD,
  THREAD,
  VIDEO,
  cleanUp,
  freshTokens,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_comment_reply", () => {
  test("reads the thread, the channel and the video, then sends one POST of the reply to the thread", async () => {
    const h = await writeFixture()

    await h.commentReply.run()

    expect(h.lines()).toEqual([
      `GET ${COMMENT_THREADS_URL}`,
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `POST ${COMMENTS_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({
      part: "snippet",
      id: THREAD,
      textFormat: "plainText",
    })
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ part: "snippet" })
    expect(post!.json).toEqual({ snippet: { parentId: THREAD, textOriginal: "Thanks for watching!" } })
  })

  test("returns the video, the thread and the reply as the read shapes a reply", async () => {
    const h = await writeFixture()

    const result = await h.commentReply.run()

    expect(result).toEqual({
      video_id: VIDEO,
      thread: THREAD,
      reply: {
        comment_id: NEW_REPLY,
        author: "Someone",
        author_channel_id: expect.any(String),
        text: "Thanks for watching!",
        text_clipped: false,
        like_count: 3,
        published_at: expect.any(String),
        updated_at: expect.any(String),
        reply_count: null,
        replies: null,
      },
    })
  })

  test("sends the text as it was given, white space included, and takes 10,000 code points", async () => {
    const h = await writeFixture()

    await h.commentReply.run({ text: " Hello\n" })
    await h.commentReply.run({ text: "😀".repeat(10_000) })

    expect(h.writes().map((post) => (post.json as { snippet: { textOriginal: string } }).snippet.textOriginal)).toEqual(
      [" Hello\n", "😀".repeat(10_000)],
    )
  })

  test("replies to any thread of the channel's videos, as the thread's own id", async () => {
    const h = await writeFixture()

    await h.commentReply.run({ thread: OTHER_THREAD })

    expect((h.writes()[0]!.json as { snippet: { parentId: string } }).snippet.parentId).toBe(OTHER_THREAD)
  })

  test("the target is the thread on the video of the label", async () => {
    const h = await writeFixture()

    expect(await h.commentReply.targets()).toEqual([`work/videos/${VIDEO}/comments/${THREAD}`])
  })

  test("the target is * when Google cannot tell, and nothing is sent", async () => {
    const h = await writeFixture()

    expect(await h.commentReply.targets({ thread: "UgxNoSuchThread" })).toEqual(["*"])
    expect(h.writes()).toEqual([])
  })
})
