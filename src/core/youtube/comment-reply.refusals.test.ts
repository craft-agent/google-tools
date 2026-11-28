import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  REPLY,
  THREAD,
  TITLE,
  VIDEO,
  cleanUp,
  commentInsertHandler,
  freshTokens,
  refusal,
  threadResource,
  threadsHandler,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_comment_reply: a thread that is not the channel's to reply to", () => {
  test("a thread on another channel's video is forbidden, names the video and sends nothing", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))] })

    const error = await toolError(h.commentReply.run())

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("a thread Google does not return is not_found", async () => {
    const h = await writeFixture()

    const error = await toolError(h.commentReply.run({ thread: "UgxNoSuchThread" }))

    expect(error).toMatchObject({ code: "not_found" })
    expect(error.message).toContain("UgxNoSuchThread")
    expect(h.writes()).toEqual([])
  })

  test("a thread that takes no replies is forbidden, sending nothing", async () => {
    const h = await writeFixture({ handlers: [threadsHandler(threadResource(THREAD, "Closed.", { canReply: false }))] })

    const error = await toolError(h.commentReply.run())

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("takes no replies")
    expect(h.writes()).toEqual([])
  })

  test("a thread Google gives no video for is an upstream_error", async () => {
    const h = await writeFixture({ handlers: [threadsHandler(threadResource(THREAD, "x", { videoId: undefined }))] })

    expect((await toolError(h.commentReply.run())).code).toBe("upstream_error")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    const error = await toolError(h.commentReply.run())

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_reply: a call that cannot be", () => {
  test("a reply's id as the thread is invalid_argument, pointing to the top-level comment, before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.commentReply.run({ thread: REPLY }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("top-level comment")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["an empty text", "", "must not be blank"],
    ["a blank text", " \n\t", "must not be blank"],
    ["a text of 10,001 code points", "😀".repeat(10_001), "1 to 10000 characters, not 10001"],
  ])("%s is invalid_argument before any request", async (_name, text, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.commentReply.run({ text }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a thread that is no comment id", "a/b"],
    ["an empty thread", ""],
  ])("%s is invalid_argument before any request", async (_name, thread) => {
    const h = await writeFixture()

    expect((await toolError(h.commentReply.run({ thread }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_reply: Google's refusals", () => {
  test.each([
    ["commentTextTooLong", 400, "invalid_argument"],
    ["commentTextRequired", 400, "invalid_argument"],
    ["parentIdMissing", 400, "invalid_argument"],
    ["operationNotSupported", 403, "forbidden"],
    ["forbidden", 403, "forbidden"],
    ["parentCommentNotFound", 404, "not_found"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [commentInsertHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.commentReply.run())

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({ handlers: [commentInsertHandler(refusal(403, "quotaExceeded", "Quota."))] })

    const error = await toolError(h.commentReply.run())

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
