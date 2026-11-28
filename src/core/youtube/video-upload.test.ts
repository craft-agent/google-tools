import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  NEW_VIDEO_ID,
  SESSION_URI,
  SMALL_CHUNK,
  UPLOAD_URL,
  cleanUp,
  freshTokens,
  rangesOf,
  uploadFixture,
} from "./video-upload.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A file of `size` bytes whose content varies from one byte to the next. */
const patterned = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 7) % 251))

const SIZE = 600_000

/** A final answer from Google with `status` laid over a private, uploaded video. */
const finalReply = (status: Record<string, unknown>): FakeHandler => ({
  method: "PUT",
  url: UPLOAD_URL,
  reply: {
    json: { id: NEW_VIDEO_ID, snippet: { title: "My new video" }, status: { uploadStatus: "uploaded", ...status } },
  },
})

describe("google_youtube_video_upload", () => {
  test("uploads a small file in one chunk and says what it made", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    const result = await h.upload({ path: join(h.uploadDir, "clip.mp4") })

    expect(result).toEqual({
      video_id: NEW_VIDEO_ID,
      url: `https://www.youtube.com/watch?v=${NEW_VIDEO_ID}`,
      title: "My new video",
      privacy: "private",
      upload_status: "uploaded",
      made_for_kids: false,
      note: null,
    })
    expect(Buffer.from(h.received()).toString()).toBe("made-up video")
    expect(rangesOf(h)).toEqual(["bytes 0-12/13"])
  })

  test("starts the session as private with the parts, the type and the size, and chunks go to its address", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    await h.upload({ path: join(h.uploadDir, "clip.mp4") })
    const [start] = h.uploads()

    expect(start?.method).toBe("POST")
    expect(Object.fromEntries(start!.url.searchParams)).toEqual({ uploadType: "resumable", part: "snippet,status" })
    expect(start?.json).toEqual({
      snippet: { title: "My new video", categoryId: "22" },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    })
    expect(start?.headers["x-upload-content-type"]).toBe("video/mp4")
    expect(start?.headers["x-upload-content-length"]).toBe("13")
    expect(h.uploads()[1]?.url.href).toBe(SESSION_URI)
  })

  test("sends every argument it was given, privacy private still", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    await h.upload({
      path: join(h.uploadDir, "clip.mp4"),
      description: "About made-up things.",
      tags: ["made", "up thing"],
      category: "27",
      default_language: "ja",
      default_audio_language: "en",
      license: "creativeCommon",
      embeddable: false,
      public_stats: true,
      made_for_kids: true,
      synthetic_media: true,
    })

    expect(h.uploads()[0]?.json).toEqual({
      snippet: {
        title: "My new video",
        description: "About made-up things.",
        tags: ["made", "up thing"],
        categoryId: "27",
        defaultLanguage: "ja",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus: "private",
        selfDeclaredMadeForKids: true,
        license: "creativeCommon",
        embeddable: false,
        publicStatsViewable: true,
        containsSyntheticMedia: true,
      },
    })
  })

  test("leaves an empty tag list out", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    await h.upload({ path: join(h.uploadDir, "clip.mp4"), tags: [] })
    expect((h.uploads()[0]?.json as { snippet: object }).snippet).not.toHaveProperty("tags")
  })

  test.each([
    ["clip.mp4", "video/mp4"],
    ["clip.MOV", "video/quicktime"],
    ["clip.m4v", "video/x-m4v"],
    ["clip.webm", "video/webm"],
    ["clip.mkv", "video/x-matroska"],
    ["clip.Avi", "video/x-msvideo"],
  ])("sends %s as %s", async (file, type) => {
    const h = await uploadFixture({ files: { [file]: "made-up video" } })
    await h.upload({ path: join(h.uploadDir, file) })
    expect(h.uploads()[0]?.headers["x-upload-content-type"]).toBe(type)
    expect(h.uploads()[1]?.headers["content-type"]).toBe(type)
  })

  test("sends a larger file in chunks of the chunk size, and every byte arrives", async () => {
    const content = patterned(SIZE)
    const h = await uploadFixture({ files: { "big.mp4": content } })
    const result = await h.upload({ path: join(h.uploadDir, "big.mp4") })

    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${2 * SMALL_CHUNK}-${SIZE - 1}/${SIZE}`,
    ])
    expect(Buffer.compare(h.received(), content)).toBe(0)
    expect(result.video_id).toBe(NEW_VIDEO_ID)
  })

  test("sends again from the offset Google says when it took in fewer bytes", async () => {
    const content = patterned(SIZE)
    const h = await uploadFixture({
      files: { "big.mp4": content },
      session: { acknowledge: (held, _chunk, count) => (count === 2 ? SMALL_CHUNK : held) },
    })
    await h.upload({ path: join(h.uploadDir, "big.mp4") })

    expect(rangesOf(h)).toHaveLength(4)
    expect(Buffer.compare(h.received(), content)).toBe(0)
  })

  test("a reply that does not say it is private gives the note, pointing to YouTube Studio", async () => {
    const h = await uploadFixture({
      handlers: [finalReply({ privacyStatus: "public", madeForKids: false })],
      files: { "clip.mp4": "made-up video" },
    })
    const result = await h.upload({ path: join(h.uploadDir, "clip.mp4") })

    expect(result.privacy).toBe("public")
    expect(result.note).toContain("public")
    expect(result.note).toContain("YouTube Studio")
  })

  test("a reply with no fields still returns what is known: the video exists", async () => {
    const h = await uploadFixture({
      handlers: [{ method: "PUT", url: UPLOAD_URL, reply: { json: {} } }],
      files: { "clip.mp4": "made-up video" },
    })

    expect(await h.upload({ path: join(h.uploadDir, "clip.mp4"), made_for_kids: true })).toEqual({
      video_id: "",
      url: null,
      title: "My new video",
      privacy: null,
      upload_status: null,
      made_for_kids: true,
      note: null,
    })
  })

  test("takes the made-for-kids value Google reports over the declared one", async () => {
    const h = await uploadFixture({
      handlers: [finalReply({ privacyStatus: "private", madeForKids: true, selfDeclaredMadeForKids: false })],
      files: { "clip.mp4": "made-up video" },
    })
    expect((await h.upload({ path: join(h.uploadDir, "clip.mp4") })).made_for_kids).toBe(true)
  })

  test("reads the label's channel before it uploads", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    await h.upload({ path: join(h.uploadDir, "clip.mp4") })
    expect(h.lines()[0]).toBe("GET https://youtube.googleapis.com/youtube/v3/channels")
  })
})
