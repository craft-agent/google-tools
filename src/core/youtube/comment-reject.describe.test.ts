import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeCommentReject } from "./comment-reject"
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
  return h.commentReject.describe(args)
}

const TWO = { comments: [THREAD, OTHER_THREAD] }

describe("google_youtube_comment_reject describe", () => {
  test.each([
    [{}, "About to reject {count} comment", "1"],
    [{ ban_author: true }, "About to reject {count} comment and ban its author", "1"],
    [TWO, "About to reject {count} comments", "2"],
    [{ ...TWO, ban_author: true }, "About to reject {count} comments and ban their authors", "2"],
  ])("headlines %o with the count of comments", async (args, text, count) => {
    expect((await described(args)).headline).toEqual({ text, values: { count } })
  })

  test("says first that a rejection cannot be undone, then whether the authors are banned, then who can watch", async () => {
    const undo = { label: "Undo", value: { text: "none: a rejected comment cannot be published again" } }

    expect((await described({})).facts).toEqual([
      undo,
      { label: "Ban", value: { text: "no" } },
      { label: "Privacy", value: { text: "public" } },
    ])
    expect((await described({ ban_author: true })).facts).toEqual([
      undo,
      { label: "Ban", value: { text: "yes: the authors' later comments are kept off the channel" } },
      { label: "Privacy", value: { text: "public" } },
    ])
  })

  test("shows how many videos there are when the comments are on several", async () => {
    const comments = [topComment(), topComment(OTHER_THREAD, "Elsewhere.", { videoId: OTHER_VIDEO })]
    const other = { ...writableVideo(), id: OTHER_VIDEO }
    const h = await writeFixture({ handlers: [commentsHandler(...comments), videoHandler(writableVideo(), other)] })

    const description = await h.commentReject.describe(TWO)

    expect(description.facts[2]).toEqual({
      label: "Videos",
      value: { text: "{count} videos", values: { count: 2 } },
    })
  })

  test("lists each comment as its author and its text", async () => {
    const comments = [
      topComment(THREAD, "Spam!"),
      topComment(OTHER_THREAD, "More\nspam.", { authorDisplayName: "Bot" }),
    ]

    const description = await described(TWO, comments)

    expect(description.text).toEqual({ label: "Comments", body: "Someone: Spam!\nBot: More spam." })
  })

  test("pins the comments and the videos, which change when a comment or a video does", async () => {
    const pins = async (comments: { id: string }[] = [], video = writableVideo()) =>
      (await described({}, comments, video)).pins!
    const base = await pins()

    expect(await pins()).toEqual(base)
    expect((await pins([topComment(THREAD, "Edited.")])).comments).not.toBe(base.comments)
    expect((await pins([topComment(THREAD, undefined, { moderationStatus: "heldForReview" })])).comments).not.toBe(
      base.comments,
    )
    expect((await pins([], writableVideo({ status: { privacyStatus: "private" } }))).videos).not.toBe(base.videos)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubeCommentReject, { comments: [THREAD] }, h.ctx)

    expect(whole?.headline?.text).toBe("About to reject {count} comment")
    expect(whole?.facts).toHaveLength(3)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeCommentReject.title]).toBeDefined()
    expect(ja[googleYoutubeCommentReject.intent!]).toBeDefined()
    for (const template of [
      "About to reject {count} comment",
      "About to reject {count} comments",
      "About to reject {count} comment and ban its author",
      "About to reject {count} comments and ban their authors",
    ]) {
      expect(ja[template]).toContain("{count}")
    }
    for (const word of [
      "Undo",
      "Ban",
      "none: a rejected comment cannot be published again",
      "yes: the authors' later comments are kept off the channel",
      "no",
    ]) {
      expect(ja[word]).toBeDefined()
    }
  })

  test("throws where execute would: a comment that is gone, a video of another channel", async () => {
    const gone = await writeFixture()
    expect((await toolError(gone.commentReject.describe({ comments: ["UgxNoSuchComment"] }))).code).toBe("not_found")

    const other = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { channelId: "UCotherMadeUpChanId01234" } }))],
    })
    expect((await toolError(other.commentReject.describe())).code).toBe("forbidden")
  })
})
