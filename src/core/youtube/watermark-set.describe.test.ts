import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import { googleYoutubeWatermarkSet } from "./watermark-set"
import {
  CHANNEL,
  CHANNEL_TITLE,
  channelHandler,
  cleanUp,
  freshTokens,
  writableChannel,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FILES = { "mark.jpg": JPEG_BYTES, "mark.png": PNG_BYTES }

describe("google_youtube_watermark_set describe", () => {
  test("headlines the channel's name as Google has it and shows when, the file, its size and its type", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "mark.jpg")

    const description = await h.watermarkSet.describe({ path })

    expect(description.headline).toEqual({
      text: "About to set the watermark of {channel}",
      values: { channel: CHANNEL_TITLE },
    })
    expect(description.facts).toEqual([
      { label: "Shown", value: { text: "the whole video" } },
      { label: "From", value: path },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: JPEG_BYTES.length } } },
      { label: "Type", value: "JPEG" },
    ])
    expect(description.text).toBeUndefined()
  })

  test.each([
    ["the whole video", {}, { text: "the whole video" }],
    [
      "from a moment to the end",
      { offset_seconds: 30 },
      { text: "from {offset} s after the start", values: { offset: 30 } },
    ],
    [
      "from a moment for a time",
      { offset_seconds: 30, duration_seconds: 10 },
      { text: "from {offset} s after the start, for {duration} s", values: { offset: 30, duration: 10 } },
    ],
    ["the first seconds", { duration_seconds: 5 }, { text: "for the first {duration} s", values: { duration: 5 } }],
    [
      "the last seconds to the end",
      { from: "end", offset_seconds: 15 },
      { text: "from {offset} s before the end", values: { offset: 15 } },
    ],
    [
      "the last seconds for a time",
      { from: "end", offset_seconds: 15, duration_seconds: 5 },
      { text: "from {offset} s before the end, for {duration} s", values: { offset: 15, duration: 5 } },
    ],
  ])("shows %s as the Shown fact", async (_name, args, value) => {
    const h = await writeFixture({ files: FILES })

    const { facts } = await h.watermarkSet.describe({ path: join(h.uploadDir, "mark.png"), ...args })

    expect(facts[0]).toEqual({ label: "Shown", value })
    expect(facts.at(-1)).toEqual({ label: "Type", value: "PNG" })
  })

  test("pins the file's content and the channel, and a file or a channel that changed gives another pin", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "mark.jpg")
    const base = (await h.watermarkSet.describe({ path })).pins

    expect(base).toEqual({
      content: expect.stringMatching(/^[0-9a-f]{64}$/),
      channel: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect((await h.watermarkSet.describe({ path })).pins).toEqual(base)

    await writeFile(path, new Uint8Array([...JPEG_BYTES, 0x01]))
    const changedFile = (await h.watermarkSet.describe({ path })).pins
    expect(changedFile?.content).not.toBe(base?.content)
    expect(changedFile?.channel).toBe(base?.channel)

    const renamed = await writeFixture({
      files: FILES,
      handlers: [channelHandler(CHANNEL, writableChannel({ snippet: { title: "Renamed" } }))],
    })
    const changedChannel = (await renamed.watermarkSet.describe({ path: join(renamed.uploadDir, "mark.jpg") })).pins
    expect(changedChannel?.channel).not.toBe(base?.channel)
    expect(changedChannel?.content).toBe(base?.content)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ files: FILES })

    const whole = await wholeCallDescription(googleYoutubeWatermarkSet, { path: join(h.uploadDir, "mark.jpg") }, h.ctx)

    expect(whole?.headline).toEqual({
      text: "About to set the watermark of {channel}",
      values: { channel: CHANNEL_TITLE },
    })
    expect(whole?.facts).toHaveLength(4)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeWatermarkSet.title]).toBeDefined()
    expect(ja[googleYoutubeWatermarkSet.intent!]).toBeDefined()
    expect(ja["About to set the watermark of {channel}"]).toContain("{channel}")
    expect(ja.Shown).toBeDefined()
    for (const word of [
      "the whole video",
      "from {offset} s after the start",
      "from {offset} s before the end",
      "for the first {duration} s",
      "from {offset} s after the start, for {duration} s",
      "from {offset} s before the end, for {duration} s",
    ]) {
      expect(ja[word]).toBeDefined()
    }
  })

  test("throws where execute would: a timing that cannot be, a file that is not there", async () => {
    const h = await writeFixture({ files: FILES })

    expect((await toolError(h.watermarkSet.describe({ path: join(h.uploadDir, "mark.jpg"), from: "end" }))).code).toBe(
      "invalid_argument",
    )
    expect((await toolError(h.watermarkSet.describe({ path: join(h.uploadDir, "none.jpg") }))).code).toBe("not_found")
  })
})
