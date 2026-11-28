import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { cleanUp, freshTokens, uploadFixture } from "./video-upload.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_video_upload bounds", () => {
  test("declares the bytes bound as a maximum", async () => {
    const h = await uploadFixture()

    expect(h.tool.bounds).toEqual({ bytes: { kind: "max", description: "The most bytes the file may hold." } })
  })

  test("measures the file's size in bytes, making no upload", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })

    expect(await h.measure({ path: join(h.uploadDir, "clip.mp4") })).toEqual({ bytes: 13 })
    expect(h.uploads()).toEqual([])
  })

  test("measures the real size of a larger file", async () => {
    const h = await uploadFixture({ files: { "big.mp4": Buffer.alloc(600_000) } })

    expect(await h.measure({ path: join(h.uploadDir, "big.mp4") })).toEqual({ bytes: 600_000 })
  })

  test("fails to measure a file it would refuse, so a grant that sets the bound covers nothing", async () => {
    const h = await uploadFixture({ files: { "clip.gif": "made-up" } })

    await expect(h.measure({ path: join(h.uploadDir, "clip.gif") })).rejects.toMatchObject({ code: "invalid_argument" })
  })
})
