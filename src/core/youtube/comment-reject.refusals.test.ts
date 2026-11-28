import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  moderateHandler,
  refusal,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_comment_reject: comments that are not the channel's to reject", () => {
  test("a comment on another channel's video is forbidden, even with a ban, and sends nothing", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))] })

    const error = await toolError(h.commentReject.run({ ban_author: true }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(h.writes()).toEqual([])
  })

  test("a comment Google does not return is not_found, naming it", async () => {
    const h = await writeFixture()

    const error = await toolError(h.commentReject.run({ comments: ["UgxGone1"] }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain('"UgxGone1"')
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    expect((await toolError(h.commentReject.run())).code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_reject: a call that cannot be", () => {
  test.each([
    ["no comments", { comments: [] }],
    ["51 comments", { comments: Array.from({ length: 51 }, (_, index) => `UgxMadeUp${index}`) }],
    ["a ban that is not a boolean", { ban_author: "yes" }],
    ["a comment that is no id", { comments: ["a b"] }],
  ])("%s is invalid_argument before any request", async (_name, args) => {
    const h = await writeFixture()

    expect((await toolError(h.commentReject.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_comment_reject: Google's refusals", () => {
  test.each([
    ["banWithoutReject", 400, "invalid_argument"],
    ["invalidModerationStatus", 400, "invalid_argument"],
    ["commentNotFound", 404, "not_found"],
    ["processingFailure", 400, "upstream_error"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({ handlers: [moderateHandler(refusal(status, reason, "Google says no."))] })

    const error = await toolError(h.commentReject.run({ ban_author: true }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })
})
