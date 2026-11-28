import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OTHER_CHANNEL,
  OTHER_THREAD,
  OTHER_VIDEO,
  READ_ONLY_CREDENTIAL,
  THREAD,
  TITLE,
  VIDEO,
  cleanUp,
  commentsHandler,
  freshTokens,
  moderateHandler,
  refusal,
  threadResource,
  threadsHandler,
  topComment,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FOREIGN = writableVideo({ snippet: { channelId: OTHER_CHANNEL } })

describe("google_youtube_comment_moderate: comments that are not the channel's to moderate", () => {
  test("a comment on another channel's video is forbidden, names the video and sends nothing", async () => {
    const h = await writeFixture({ handlers: [videoHandler(FOREIGN)] })

    const error = await toolError(h.commentModerate.run())

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("one comment on another channel's video among the channel's own refuses the whole call", async () => {
    const elsewhere = {
      ...writableVideo({ snippet: { channelId: OTHER_CHANNEL, title: "Elsewhere" } }),
      id: OTHER_VIDEO,
    }
    const h = await writeFixture({
      handlers: [
        commentsHandler(topComment(THREAD), topComment(OTHER_THREAD, "Other.", { videoId: OTHER_VIDEO })),
        videoHandler(writableVideo(), elsewhere),
      ],
    })

    const error = await toolError(h.commentModerate.run({ comments: [THREAD, OTHER_THREAD] }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"Elsewhere" (${OTHER_VIDEO})`)
    expect(error.message).not.toContain(VIDEO + ")")
    expect(h.writes()).toEqual([])
  })

  test("a comment Google does not return is not_found, naming every id it left out", async () => {
    const h = await writeFixture()

    const error = await toolError(h.commentModerate.run({ comments: [THREAD, "UgxGone1", "UgxGone2"] }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain('"UgxGone1"')
    expect(error.message).toContain('"UgxGone2"')
    expect(error.message).not.toContain(THREAD)
    expect(h.writes()).toEqual([])
  })

  test("a reply whose thread Google does not return is not_found", async () => {
    const h = await writeFixture({ handlers: [threadsHandler(threadResource(OTHER_THREAD))] })

    const error = await toolError(h.commentModerate.run({ comments: [`${THREAD}.MadeUpReplyId01`] }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("Thread")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({ handlers: [commentsHandler(topComment(THREAD, "x", { videoId: OTHER_VIDEO }))] })

    const error = await toolError(h.commentModerate.run())

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(OTHER_VIDEO)
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    const error = await toolError(h.commentModerate.run())

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_moderate: a call that cannot be", () => {
  test.each([
    ["no comments", { comments: [] }],
    ["51 comments", { comments: Array.from({ length: 51 }, (_, index) => `UgxMadeUp${index}`) }],
    ["a moderation Google has but this tool does not", { moderation: "reject" }],
    ["a comment that is no id", { comments: ["a/b"] }],
  ])("%s is invalid_argument before any request", async (_name, args) => {
    const h = await writeFixture()

    expect((await toolError(h.commentModerate.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_moderate: Google's refusals", () => {
  test.each([
    ["invalidModerationStatus", 400, "invalid_argument"],
    ["banWithoutReject", 400, "invalid_argument"],
    ["commentNotFound", 404, "not_found"],
    ["forbidden", 403, "forbidden"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [moderateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.commentModerate.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })
})
