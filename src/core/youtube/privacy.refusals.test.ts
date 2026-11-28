import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  refusal,
  updateHandler,
  videoHandler,
  videoReplyHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const PRIVATE = writableVideo({ status: { privacyStatus: "private" } })
const SCHEDULED = writableVideo({ status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" } })

describe("google_youtube_privacy_set: a video that is not the channel's to change", () => {
  test("another channel's video is forbidden, names the video and sends nothing", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))] })

    const error = await toolError(h.privacy.run({ privacy: "private" }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({ handlers: [videoReplyHandler({ json: {} })] })

    expect(await toolError(h.privacy.run({ privacy: "private" }))).toMatchObject({
      code: "not_found",
      message: `Video ${VIDEO} was not found, or the account cannot see it.`,
    })
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request, even to make a video private", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    const error = await toolError(h.privacy.run({ privacy: "private" }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_privacy_set: a call that cannot be", () => {
  test.each([
    ["neither argument", {}, "exactly one"],
    ["both arguments", { privacy: "private", publish_at: "2026-12-24T09:00:00+09:00" }, "exactly one"],
    ["a privacy Google does not have", { privacy: "hidden" }, "privacy"],
    ["a time with no offset", { publish_at: "2026-12-24T09:00:00" }, "RFC 3339 time with an offset"],
    ["a time that is not a time", { publish_at: "tomorrow" }, "RFC 3339 time with an offset"],
    ["a day that is not on the calendar", { publish_at: "2026-02-30T00:00:00Z" }, "RFC 3339 time with an offset"],
    ["an hour that is not on the clock", { publish_at: "2026-12-24T24:00:00Z" }, "RFC 3339 time with an offset"],
    ["an offset that is not one", { publish_at: "2026-12-24T09:00:00+25:00" }, "RFC 3339 time with an offset"],
    ["a time that has passed", { publish_at: "2026-06-01T11:59:59Z" }, "`privacy: public`"],
    ["the time it is now", { publish_at: "2026-06-01T21:00:00+09:00" }, "not in the future"],
  ])("refuses %s as invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture()

    const error = await toolError(h.privacy.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test.each([
    ["public to public", writableVideo(), { privacy: "public" }, "already public, with no schedule"],
    [
      "unlisted to unlisted",
      writableVideo({ status: { privacyStatus: "unlisted" } }),
      { privacy: "unlisted" },
      "already unlisted",
    ],
    ["private to private with no schedule", PRIVATE, { privacy: "private" }, "already private, with no schedule"],
    [
      "a schedule to the same instant",
      SCHEDULED,
      { publish_at: "2026-12-24T09:00:00+09:00" },
      "already scheduled for 2026-12-24T00:00:00Z",
    ],
  ])("refuses %s as invalid_argument, sending nothing", async (_name, video, args, hint) => {
    const h = await writeFixture({ handlers: [videoHandler(video)] })

    const error = await toolError(h.privacy.run(args))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.writes()).toEqual([])
  })

  test("a schedule to another instant than the one set is sent", async () => {
    const h = await writeFixture({ handlers: [videoHandler(SCHEDULED)] })

    await h.privacy.run({ publish_at: "2026-12-24T09:00:01+09:00" })

    expect(h.writes()).toHaveLength(1)
  })
})

describe("google_youtube_privacy_set: Google's refusals", () => {
  test("a 400 invalidPublishAt is invalid_argument with Google's message", async () => {
    const h = await writeFixture({
      handlers: [
        videoHandler(PRIVATE),
        updateHandler(refusal(400, "invalidPublishAt", "The publish time is invalid.")),
      ],
    })

    const error = await toolError(h.privacy.run({ publish_at: "2026-12-24T09:00:00+09:00" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("The publish time is invalid.")
  })

  test("a 403 forbidden stays forbidden, and a spent quota says when it resets", async () => {
    const denied = await writeFixture({ handlers: [updateHandler(refusal(403, "forbidden", "Not yours."))] })
    expect((await toolError(denied.privacy.run({ privacy: "private" }))).code).toBe("forbidden")

    const spent = await writeFixture({ handlers: [updateHandler(refusal(403, "quotaExceeded", "Quota."))] })
    const error = await toolError(spent.privacy.run({ privacy: "private" }))
    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
