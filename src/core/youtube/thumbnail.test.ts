import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import { THUMBNAILS_URL, VIDEO, cleanUp, freshTokens, thumbnailHandler, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_thumbnail_set", () => {
  test("posts the file's exact bytes to the upload route with the video id and its media type", async () => {
    const h = await writeFixture({ files: { "cover.jpg": JPEG_BYTES } })

    await h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") })

    expect(h.lines()).toEqual([
      "GET https://youtube.googleapis.com/youtube/v3/channels",
      "GET https://youtube.googleapis.com/youtube/v3/videos",
      `POST ${THUMBNAILS_URL}`,
    ])
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ videoId: VIDEO, uploadType: "media" })
    expect(post!.headers["content-type"]).toBe("image/jpeg")
    expect(Array.from(post!.bytes!)).toEqual(Array.from(JPEG_BYTES))
  })

  test.each([
    ["cover.png", PNG_BYTES, "image/png"],
    ["COVER.JPEG", JPEG_BYTES, "image/jpeg"],
    ["cover.JPG", JPEG_BYTES, "image/jpeg"],
  ])("sends %s as %s, the type told by its bytes", async (name, bytes, type) => {
    const h = await writeFixture({ files: { [name]: bytes } })

    await h.thumbnail.run({ path: join(h.uploadDir, name) })

    const [post] = h.writes()
    expect(post!.headers["content-type"]).toBe(type)
    expect(Array.from(post!.bytes!)).toEqual(Array.from(bytes))
  })

  test("returns the video, its address and the thumbnails Google reports, null for a size it leaves out", async () => {
    const h = await writeFixture({ files: { "cover.jpg": JPEG_BYTES } })

    const result = await h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg"), video: `https://youtu.be/${VIDEO}` })

    expect(result).toEqual({
      video_id: VIDEO,
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
      thumbnails: {
        default: { url: "https://i.ytimg.test/default.jpg", width: 120, height: 90 },
        medium: { url: "https://i.ytimg.test/mqdefault.jpg", width: 320, height: 180 },
        high: { url: "https://i.ytimg.test/hqdefault.jpg", width: null, height: null },
        standard: null,
        maxres: null,
      },
    })
  })

  test("a reply with no thumbnails gives null for every size", async () => {
    const h = await writeFixture({
      files: { "cover.png": PNG_BYTES },
      handlers: [thumbnailHandler({ json: {} })],
    })

    const result = await h.thumbnail.run({ path: join(h.uploadDir, "cover.png") })

    expect(result).toMatchObject({
      thumbnails: { default: null, medium: null, high: null, standard: null, maxres: null },
    })
  })

  test("takes the video as an address, and the target is the video of the label", async () => {
    const h = await writeFixture({ files: { "cover.jpg": JPEG_BYTES } })
    const path = join(h.uploadDir, "cover.jpg")

    expect((await h.thumbnail.run({ path, video: `https://www.youtube.com/watch?v=${VIDEO}` })).video_id).toBe(VIDEO)
    expect(await h.thumbnail.targets({ path })).toEqual([`work/videos/${VIDEO}`])
  })
})
