import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { LATIN1_SRT, SRT } from "./caption.testing"
import {
  CAPTION_UPLOAD_URL,
  TRACK,
  TRACK_DRAFT,
  VIDEO,
  cleanUp,
  freshTokens,
  relatedParts,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CAPTIONS_URL = "https://youtube.googleapis.com/youtube/v3/captions"

describe("google_youtube_caption_update with a file", () => {
  test("puts the metadata and the file's exact bytes as one multipart/related body, the draft state the track's", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    await h.captionUpdate.run({ path: join(h.uploadDir, "en.srt") })

    expect(h.lines()).toEqual([
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `GET ${CAPTIONS_URL}`,
      `PUT ${CAPTION_UPLOAD_URL}`,
    ])
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ uploadType: "multipart", part: "snippet" })
    expect(put!.headers["content-type"]).toMatch(/^multipart\/related; boundary="[^"]+"$/)
    const [metadata, media] = relatedParts(put!)
    expect(metadata!.json).toEqual({ id: TRACK, snippet: { isDraft: false } })
    expect(media!.type).toBe("application/octet-stream")
    expect(media!.bytes.toString()).toBe(SRT)
  })

  test("sends the draft state asked for beside the file, and the file of a draft keeps it a draft", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT, "latin.srt": LATIN1_SRT } })

    await h.captionUpdate.run({ path: join(h.uploadDir, "en.srt"), draft: true })
    await h.captionUpdate.run({ path: join(h.uploadDir, "latin.srt"), caption: TRACK_DRAFT })

    const [asked, kept] = h.writes().map((request) => relatedParts(request))
    expect(asked![0]!.json).toEqual({ id: TRACK, snippet: { isDraft: true } })
    expect(kept![0]!.json).toEqual({ id: TRACK_DRAFT, snippet: { isDraft: true } })
    expect(Array.from(kept![1]!.bytes)).toEqual(Array.from(LATIN1_SRT))
  })

  test("takes a file with a draft state the track has already", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    await h.captionUpdate.run({ path: join(h.uploadDir, "en.srt"), draft: false })

    expect(h.writes()).toHaveLength(1)
  })

  test("returns the track as it was read and as Google reports it now", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    const result = await h.captionUpdate.run({ path: join(h.uploadDir, "en.srt"), video: `https://youtu.be/${VIDEO}` })

    expect(result).toEqual({
      video_id: VIDEO,
      before: {
        caption_id: TRACK,
        language: "en",
        name: "English",
        kind: "standard",
        draft: false,
        status: "serving",
        updated_at: "2026-03-05T08:00:00Z",
      },
      caption: {
        caption_id: TRACK,
        language: "en",
        name: "English",
        kind: "standard",
        draft: false,
        status: "serving",
        updated_at: "2026-04-01T00:00:00Z",
      },
    })
  })
})

describe("google_youtube_caption_update with the draft state alone", () => {
  test("puts only the id and isDraft to the caption route, not the upload one", async () => {
    const h = await writeFixture()

    await h.captionUpdate.run({ draft: true })

    expect(h.lines()).toEqual([
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `GET ${CAPTIONS_URL}`,
      `PUT ${CAPTIONS_URL}`,
    ])
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "snippet" })
    expect(put!.headers["content-type"]).toContain("application/json")
    expect(put!.json).toEqual({ id: TRACK, snippet: { isDraft: true } })
  })

  test("publishes a draft and returns what Google reports", async () => {
    const h = await writeFixture()

    const result = await h.captionUpdate.run({ caption: TRACK_DRAFT, draft: false })

    expect(h.writes()[0]!.json).toEqual({ id: TRACK_DRAFT, snippet: { isDraft: false } })
    expect(result).toMatchObject({
      before: { caption_id: TRACK_DRAFT, draft: true },
      caption: { caption_id: TRACK_DRAFT, draft: false, updated_at: "2026-04-01T00:00:00Z" },
    })
  })
})

describe("google_youtube_caption_update targets", () => {
  test("is the track of the video of the label, with a file or without", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })
    const target = [`work/videos/${VIDEO}/captions/${TRACK}`]

    expect(await h.captionUpdate.targets({ draft: true })).toEqual(target)
    expect(await h.captionUpdate.targets({ path: join(h.uploadDir, "en.srt") })).toEqual(target)
  })

  test("is any target for a track id that is no id, and the call then refuses it", async () => {
    const h = await writeFixture()

    expect(await h.captionUpdate.targets({ caption: "x/y", draft: true })).toEqual(["*"])
  })
})
