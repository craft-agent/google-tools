import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { LATIN1_SRT, SRT } from "./caption.testing"
import {
  CAPTION_UPLOAD_URL,
  NEW_TRACK,
  VIDEO,
  captionInsertHandler,
  captionTrack,
  cleanUp,
  freshTokens,
  relatedParts,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_caption_add", () => {
  test("posts the metadata and the file's exact bytes as one multipart/related body", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    await h.captionAdd.run({ path: join(h.uploadDir, "en.srt") })

    expect(h.lines()).toEqual([
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      "GET https://youtube.googleapis.com/youtube/v3/captions",
      `POST ${CAPTION_UPLOAD_URL}`,
    ])
    expect(Object.fromEntries(h.calls()[2]!.url.searchParams)).toEqual({ part: "snippet", videoId: VIDEO })
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ uploadType: "multipart", part: "snippet" })
    expect(post!.headers["content-type"]).toMatch(/^multipart\/related; boundary="[^"]+"$/)
    const [metadata, media] = relatedParts(post!)
    expect(metadata).toMatchObject({
      type: "application/json; charset=UTF-8",
      json: { snippet: { videoId: VIDEO, language: "en", name: "", isDraft: false } },
    })
    expect(media!.type).toBe("application/octet-stream")
    expect(media!.bytes.toString()).toBe(SRT)
  })

  test("sends the name, the draft flag and the language as given", async () => {
    const h = await writeFixture({ files: { "ja.vtt": SRT } })

    await h.captionAdd.run({ path: join(h.uploadDir, "ja.vtt"), language: "pt-BR", name: "日本語 ✓", draft: true })

    const [metadata] = relatedParts(h.writes()[0]!)
    expect(metadata!.json).toEqual({
      snippet: { videoId: VIDEO, language: "pt-BR", name: "日本語 ✓", isDraft: true },
    })
  })

  test.each([".srt", ".vtt", ".sbv", ".ttml", ".dfxp", ".scc", ".SRT", ".Vtt"])(
    "takes a %s file and sends it as application/octet-stream",
    async (extension) => {
      const h = await writeFixture({ files: { [`captions${extension}`]: SRT } })

      await h.captionAdd.run({ path: join(h.uploadDir, `captions${extension}`) })

      expect(relatedParts(h.writes()[0]!)[1]).toMatchObject({ type: "application/octet-stream" })
    },
  )

  test("sends a file that is not valid UTF-8 byte for byte", async () => {
    const h = await writeFixture({ files: { "latin.srt": LATIN1_SRT } })

    await h.captionAdd.run({ path: join(h.uploadDir, "latin.srt") })

    expect(Array.from(relatedParts(h.writes()[0]!)[1]!.bytes)).toEqual(Array.from(LATIN1_SRT))
  })

  test("takes the video as an address and returns the new track as Google reports it", async () => {
    const h = await writeFixture({
      files: { "en.srt": SRT },
      handlers: [
        captionInsertHandler({ json: captionTrack(NEW_TRACK, { name: "Fresh", isDraft: true, status: "syncing" }) }),
      ],
    })

    const result = await h.captionAdd.run({ path: join(h.uploadDir, "en.srt"), video: `https://youtu.be/${VIDEO}` })

    expect(result).toEqual({
      video_id: VIDEO,
      caption: {
        caption_id: NEW_TRACK,
        language: "en",
        name: "Fresh",
        kind: "standard",
        draft: true,
        status: "syncing",
        updated_at: "2026-03-05T08:00:00Z",
      },
    })
  })

  test("the target is the video of the label", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    expect(await h.captionAdd.targets({ path: join(h.uploadDir, "en.srt") })).toEqual([`work/videos/${VIDEO}`])
  })
})
