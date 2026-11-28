import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  VIDEO,
  VIDEOS_URL,
  cleanUp,
  freshTokens,
  updateHandler,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The whole status of the made-up video but its privacy, as the privacy change sends it back: the made-for-kids and synthetic-media flags left out. */
const KEPT = { license: "youtube", embeddable: true, publicStatsViewable: true }

const SCHEDULED = writableVideo({ status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" } })

describe("google_youtube_privacy_set", () => {
  test("sends one PUT of the status alone, whole as read with the privacy changed", async () => {
    const h = await writeFixture()

    await h.privacy.run({ privacy: "unlisted" })

    expect(h.lines()).toEqual([
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      `GET ${VIDEOS_URL}`,
      `PUT ${VIDEOS_URL}`,
    ])
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "status" })
    expect(put!.json).toEqual({ id: VIDEO, status: { ...KEPT, privacyStatus: "unlisted" } })
  })

  test("a schedule keeps the video private and sets the time in UTC", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ status: { privacyStatus: "private" } }))] })

    const result = await h.privacy.run({ publish_at: "2026-12-24T09:00:00+09:00" })

    expect(h.writes()[0]!.json).toEqual({
      id: VIDEO,
      status: { ...KEPT, privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" },
    })
    expect(result).toEqual({
      video_id: VIDEO,
      playlist_id: null,
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
      requested: { privacy: "private", publish_at: "2026-12-24T00:00:00Z" },
      before: { privacy: "private", publish_at: null },
      after: { privacy: "private", publish_at: "2026-12-24T00:00:00Z" },
      note: null,
    })
  })

  test("a time given in another form is the same schedule", async () => {
    const h = await writeFixture({ handlers: [videoHandler(writableVideo({ status: { privacyStatus: "private" } }))] })

    await h.privacy.run({ publish_at: "2026-12-24T00:00:00.5Z" })
    await h.privacy.run({ publish_at: "2026-12-24t09:30:00+09:30" })

    expect(h.writes().map((put) => (put.json as { status: { publishAt: string } }).status.publishAt)).toEqual([
      "2026-12-24T00:00:00.500Z",
      "2026-12-24T00:00:00Z",
    ])
  })

  test("private with no time clears a schedule, and unlisted or public drop it", async () => {
    const h = await writeFixture({ handlers: [videoHandler(SCHEDULED)] })

    await h.privacy.run({ privacy: "private" })
    await h.privacy.run({ privacy: "unlisted" })
    await h.privacy.run({ privacy: "public" })

    expect(h.writes().map((put) => put.json)).toEqual(
      ["private", "unlisted", "public"].map((privacyStatus) => ({ id: VIDEO, status: { ...KEPT, privacyStatus } })),
    )
  })

  test("returns what was asked, what it was and what Google reports, with no note when they agree", async () => {
    const h = await writeFixture({ handlers: [videoHandler(SCHEDULED)] })

    const result = await h.privacy.run({ privacy: "public" })

    expect(result).toMatchObject({
      requested: { privacy: "public", publish_at: null },
      before: { privacy: "private", publish_at: "2026-12-24T00:00:00Z" },
      after: { privacy: "public", publish_at: null },
      note: null,
    })
  })

  test("a schedule Google writes with fractions of a second is the one asked for", async () => {
    const reply = { json: { id: VIDEO, status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00.000Z" } } }
    const h = await writeFixture({
      handlers: [videoHandler(writableVideo({ status: { privacyStatus: "private" } })), updateHandler(reply)],
    })

    const result = await h.privacy.run({ publish_at: "2026-12-24T09:00:00+09:00" })

    expect(result.after.publish_at).toBe("2026-12-24T00:00:00.000Z")
    expect(result.note).toBeNull()
  })

  test("says so when Google reports another privacy than was asked, and where to check", async () => {
    const reply = { json: { id: VIDEO, status: { privacyStatus: "private" } } }
    const h = await writeFixture({
      handlers: [videoHandler(writableVideo({ status: { privacyStatus: "unlisted" } })), updateHandler(reply)],
    })

    const result = await h.privacy.run({ privacy: "public" })

    expect(result.after).toEqual({ privacy: "private", publish_at: null })
    expect(result.note).toBe(
      "Google reports the video as private, not public as asked. Check it in YouTube Studio: an account setting can keep a video private.",
    )
  })

  test("says so when Google reports no schedule, or another one, than was asked", async () => {
    const dropped = { json: { id: VIDEO, status: { privacyStatus: "private" } } }
    const moved = { json: { id: VIDEO, status: { privacyStatus: "private", publishAt: "2026-12-25T00:00:00Z" } } }
    const privateVideo = videoHandler(writableVideo({ status: { privacyStatus: "private" } }))

    for (const [reply, reports] of [
      [dropped, "private"],
      [moved, "private until 2026-12-25T00:00:00Z"],
    ] as const) {
      const h = await writeFixture({ handlers: [privateVideo, updateHandler(reply)] })

      const result = await h.privacy.run({ publish_at: "2026-12-24T09:00:00+09:00" })

      expect(result.note).toStartWith(
        `Google reports the video as ${reports}, not private until 2026-12-24T00:00:00Z as asked.`,
      )
    }
  })

  test("says so when Google reports nothing of the status", async () => {
    const h = await writeFixture({ handlers: [updateHandler({ json: { id: VIDEO } })] })

    const result = await h.privacy.run({ privacy: "private" })

    expect(result.after).toEqual({ privacy: null, publish_at: null })
    expect(result.note).toContain("YouTube Studio")
  })

  test("takes the video as an address, and the target is the video of the label", async () => {
    const h = await writeFixture()

    const result = await h.privacy.run({ video: `https://www.youtube.com/watch?v=${VIDEO}`, privacy: "private" })

    expect(result.video_id).toBe(VIDEO)
    expect(await h.privacy.targets({ privacy: "private" })).toEqual([`work/videos/${VIDEO}`])
  })
})
