import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { COMMENTS_URL, OTHER_THREAD, REPLY, THREAD, VIDEO, cleanUp, freshTokens, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_comment_reject", () => {
  test("rejects the comments with one POST, banning no one unless asked", async () => {
    const h = await writeFixture()

    const result = await h.commentReject.run()

    expect(h.lines().at(-1)).toBe(`POST ${COMMENTS_URL}/setModerationStatus`)
    expect(h.writes()).toHaveLength(1)
    expect(Object.fromEntries(h.writes()[0]!.url.searchParams)).toEqual({ id: THREAD, moderationStatus: "rejected" })
    expect(result).toEqual({ comments: [THREAD], moderation: "rejected", banned_authors: false, videos: [VIDEO] })
  })

  test("`ban_author: false` sends no ban either", async () => {
    const h = await writeFixture()

    await h.commentReject.run({ ban_author: false })

    expect(h.writes()[0]!.url.searchParams.has("banAuthor")).toBe(false)
  })

  test("bans the authors when asked, and says so", async () => {
    const h = await writeFixture()

    const result = await h.commentReject.run({ comments: [THREAD, OTHER_THREAD, THREAD], ban_author: true })

    expect(Object.fromEntries(h.writes()[0]!.url.searchParams)).toEqual({
      id: `${THREAD},${OTHER_THREAD}`,
      moderationStatus: "rejected",
      banAuthor: "true",
    })
    expect(result).toEqual({
      comments: [THREAD, OTHER_THREAD],
      moderation: "rejected",
      banned_authors: true,
      videos: [VIDEO],
    })
  })

  test("finds the video of a reply through its thread, and the target is the reply's own id, sorted", async () => {
    const h = await writeFixture()

    const result = await h.commentReject.run({ comments: [REPLY] })

    expect(result.videos).toEqual([VIDEO])
    expect(await h.commentReject.targets({ comments: [REPLY, THREAD] })).toEqual([
      `work/videos/${VIDEO}/comments/${THREAD}`,
      `work/videos/${VIDEO}/comments/${REPLY}`,
    ])
  })

  test("the target is * when Google cannot tell", async () => {
    const h = await writeFixture()

    expect(await h.commentReject.targets({ comments: ["UgxNoSuchComment"] })).toEqual(["*"])
  })
})
