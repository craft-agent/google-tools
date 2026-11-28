import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeCommentModerate } from "./comment-moderate"
import {
  OTHER_THREAD,
  OTHER_VIDEO,
  THREAD,
  cleanUp,
  commentsHandler,
  freshTokens,
  topComment,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(args: unknown, comments: { id: string }[] = [], video: unknown = writableVideo()) {
  const h = await writeFixture({ handlers: [commentsHandler(...comments), videoHandler(video)] })
  return h.commentModerate.describe(args)
}

describe("google_youtube_comment_moderate describe", () => {
  test.each([
    [{ moderation: "publish" }, "About to publish {count} comment", "1"],
    [{ moderation: "hold" }, "About to hold {count} comment for review", "1"],
    [{ moderation: "publish", comments: [THREAD, OTHER_THREAD] }, "About to publish {count} comments", "2"],
    [{ moderation: "hold", comments: [THREAD, OTHER_THREAD] }, "About to hold {count} comments for review", "2"],
  ])("headlines %o with the count of comments", async (args, text, count) => {
    const description = await described(args)

    expect(description.headline).toEqual({ text, values: { count } })
  })

  test("shows who can watch the one video the comments are on", async () => {
    expect((await described({ moderation: "publish" })).facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
    ])
    const unlisted = writableVideo({ status: { privacyStatus: "unlisted" } })
    expect((await described({ moderation: "publish" }, [], unlisted)).facts[0]!.value).toEqual({ text: "unlisted" })
  })

  test("shows how many videos there are when the comments are on several", async () => {
    const comments = [topComment(), topComment(OTHER_THREAD, "Elsewhere.", { videoId: OTHER_VIDEO })]
    const other = { ...writableVideo(), id: OTHER_VIDEO }
    const h = await writeFixture({ handlers: [commentsHandler(...comments), videoHandler(writableVideo(), other)] })

    const description = await h.commentModerate.describe({ comments: [THREAD, OTHER_THREAD], moderation: "hold" })

    expect(description.facts).toEqual([{ label: "Videos", value: { text: "{count} videos", values: { count: 2 } } }])
  })

  test("lists each comment as its author and its text as Google gives it, whole", async () => {
    const long = "あ".repeat(4000)
    const comments = [
      topComment(THREAD, "First\nsecond \r\n  third"),
      topComment(OTHER_THREAD, long, { authorDisplayName: "Zed" }),
      topComment("UgxNoAuthor", "No author.", { authorDisplayName: undefined }),
    ]

    const description = await described({ comments: comments.map(({ id }) => id), moderation: "hold" }, comments)

    expect(description.text).toEqual({
      label: "Comments",
      body: `Someone: First second third\nZed: ${long}\nunknown: No author.`,
    })
  })

  test("pins the comments and the videos, which change when a comment or a video does", async () => {
    const pins = async (comments: { id: string }[] = [], video = writableVideo()) =>
      (await described({ moderation: "publish" }, comments, video)).pins!
    const base = await pins()

    expect(base).toEqual({
      comments: expect.stringMatching(/^[0-9a-f]{64}$/),
      videos: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await pins()).toEqual(base)

    for (const changed of [
      topComment(THREAD, "Edited."),
      topComment(THREAD, undefined, { moderationStatus: "heldForReview" }),
    ]) {
      const next = await pins([changed])
      expect(next.comments).not.toBe(base.comments)
      expect(next.videos).toBe(base.videos)
    }
    const made = await pins([], writableVideo({ status: { privacyStatus: "private" } }))
    expect(made.videos).not.toBe(base.videos)
    expect(made.comments).toBe(base.comments)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(
      googleYoutubeCommentModerate,
      { comments: [THREAD], moderation: "hold" },
      h.ctx,
    )

    expect(whole?.headline?.text).toBe("About to hold {count} comment for review")
    expect(whole?.facts).toHaveLength(1)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeCommentModerate.title]).toBeDefined()
    expect(ja[googleYoutubeCommentModerate.intent!]).toBeDefined()
    for (const template of [
      "About to publish {count} comment",
      "About to publish {count} comments",
      "About to hold {count} comment for review",
      "About to hold {count} comments for review",
    ]) {
      expect(ja[template]).toContain("{count}")
    }
    for (const word of ["Comments", "Videos", "{count} videos", "Privacy"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a comment that is gone, a video of another channel", async () => {
    const gone = await writeFixture()
    expect((await toolError(gone.commentModerate.describe({ comments: ["UgxNoSuchComment"] }))).code).toBe("not_found")

    const other = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { channelId: "UCotherMadeUpChanId01234" } }))],
    })
    expect((await toolError(other.commentModerate.describe())).code).toBe("forbidden")
  })
})
