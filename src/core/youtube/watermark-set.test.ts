import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import {
  CHANNEL,
  CHANNELS_URL,
  WATERMARKS_SET_URL,
  cleanUp,
  freshTokens,
  relatedParts,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FILES = { "mark.jpg": JPEG_BYTES, "mark.png": PNG_BYTES }

describe("google_youtube_watermark_set", () => {
  test("posts the metadata and the file's exact bytes as one multipart upload with the channel's id", async () => {
    const h = await writeFixture({ files: FILES })

    await h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") })

    expect(h.lines()).toEqual([`GET ${CHANNELS_URL}`, `POST ${WATERMARKS_SET_URL}`])
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({ part: "snippet", mine: "true" })
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ channelId: CHANNEL, uploadType: "multipart" })
    expect(post!.headers["content-type"]).toStartWith("multipart/related; boundary=")
    const [metadata, image] = relatedParts(post!)
    expect(metadata!.json).toEqual({ timing: { type: "offsetFromStart", offsetMs: 0 } })
    expect(image!.type).toBe("image/jpeg")
    expect(Array.from(image!.bytes)).toEqual(Array.from(JPEG_BYTES))
  })

  test.each([
    ["cover.png", PNG_BYTES, "image/png"],
    ["MARK.JPEG", JPEG_BYTES, "image/jpeg"],
  ])("sends %s as %s, the type told by its bytes", async (name, bytes, type) => {
    const h = await writeFixture({ files: { [name]: bytes } })

    await h.watermarkSet.run({ path: join(h.uploadDir, name) })

    const image = relatedParts(h.writes()[0]!)[1]!
    expect(image.type).toBe(type)
    expect(Array.from(image.bytes)).toEqual(Array.from(bytes))
  })

  test.each([
    ["the whole video by default", {}, { type: "offsetFromStart", offsetMs: 0 }],
    ["the whole video from the start", { from: "start" }, { type: "offsetFromStart", offsetMs: 0 }],
    ["from a moment to the end", { offset_seconds: 30 }, { type: "offsetFromStart", offsetMs: 30_000 }],
    [
      "from a moment for a time",
      { offset_seconds: 30, duration_seconds: 10 },
      { type: "offsetFromStart", offsetMs: 30_000, durationMs: 10_000 },
    ],
    ["the first seconds", { duration_seconds: 5 }, { type: "offsetFromStart", offsetMs: 0, durationMs: 5000 }],
    ["the last seconds", { from: "end", offset_seconds: 15 }, { type: "offsetFromEnd", offsetMs: 15_000 }],
    [
      "the last seconds for a shorter time",
      { from: "end", offset_seconds: 15, duration_seconds: 5 },
      { type: "offsetFromEnd", offsetMs: 15_000, durationMs: 5000 },
    ],
    [
      "the last seconds for exactly as long",
      { from: "end", offset_seconds: 15, duration_seconds: 15 },
      { type: "offsetFromEnd", offsetMs: 15_000, durationMs: 15_000 },
    ],
  ])("asks for %s in the metadata's timing", async (_name, args, timing) => {
    const h = await writeFixture({ files: FILES })

    await h.watermarkSet.run({ path: join(h.uploadDir, "mark.png"), ...args })

    expect(relatedParts(h.writes()[0]!)[0]!.json).toEqual({ timing })
  })

  test("returns the channel, when the watermark was asked to be shown, and where YouTube shows it", async () => {
    const h = await writeFixture({ files: FILES })

    const result = await h.watermarkSet.run({
      path: join(h.uploadDir, "mark.png"),
      from: "end",
      offset_seconds: 20,
      duration_seconds: 10,
    })

    expect(result).toEqual({
      channel_id: CHANNEL,
      shown: { from: "end", offset_seconds: 20, duration_seconds: 10 },
      note: "YouTube shows the watermark in the upper right of every video of the channel.",
    })
  })

  test("returns the whole video by default, with no duration", async () => {
    const h = await writeFixture({ files: FILES })

    const result = await h.watermarkSet.run({ path: join(h.uploadDir, "mark.png") })

    expect(result.shown).toEqual({ from: "start", offset_seconds: 0, duration_seconds: null })
  })

  test("the target is the label's channel", async () => {
    const h = await writeFixture({ files: FILES })

    expect(await h.watermarkSet.targets({ path: join(h.uploadDir, "mark.png") })).toEqual([`work/channels/${CHANNEL}`])
  })
})
