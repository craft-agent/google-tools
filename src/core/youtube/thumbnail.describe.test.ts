import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { wholeCallDescription } from "../describe"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeThumbnailSet } from "./thumbnail"
import { JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import { TITLE, VIDEO, cleanUp, freshTokens, videoHandler, writableVideo, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const FILES = { "cover.jpg": JPEG_BYTES, "cover.png": PNG_BYTES }

describe("google_youtube_thumbnail_set describe", () => {
  test("headlines the video's title as Google has it and shows its privacy, the file, its size and its type", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "cover.jpg")

    const description = await h.thumbnail.describe({ path })

    expect(description.headline).toEqual({ text: "About to set the thumbnail of {title}", values: { title: TITLE } })
    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "From", value: path },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: JPEG_BYTES.length } } },
      { label: "Type", value: "JPEG" },
    ])
    expect(description.text).toBeUndefined()
  })

  test("shows a PNG as PNG", async () => {
    const h = await writeFixture({ files: FILES })

    const { facts } = await h.thumbnail.describe({ path: join(h.uploadDir, "cover.png") })

    expect(facts.at(-1)).toEqual({ label: "Type", value: "PNG" })
  })

  test("pins the file's content and the video, and a file or a video that changed gives another pin", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "cover.jpg")
    const base = (await h.thumbnail.describe({ path })).pins

    expect(base).toEqual({
      content: expect.stringMatching(/^[0-9a-f]{64}$/),
      video: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect((await h.thumbnail.describe({ path })).pins).toEqual(base)

    await writeFile(path, new Uint8Array([...JPEG_BYTES, 0x01]))
    const changedFile = (await h.thumbnail.describe({ path })).pins
    expect(changedFile?.content).not.toBe(base?.content)
    expect(changedFile?.video).toBe(base?.video)

    const renamed = await writeFixture({
      files: FILES,
      handlers: [videoHandler(writableVideo({ snippet: { title: "Renamed" } }))],
    })
    const changedVideo = (await renamed.thumbnail.describe({ path: join(renamed.uploadDir, "cover.jpg") })).pins
    expect(changedVideo?.video).not.toBe(base?.video)
    expect(changedVideo?.content).toBe(base?.content)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ files: FILES })

    const whole = await wholeCallDescription(
      googleYoutubeThumbnailSet,
      { video: VIDEO, path: join(h.uploadDir, "cover.jpg") },
      h.ctx,
    )

    expect(whole?.headline).toEqual({ text: "About to set the thumbnail of {title}", values: { title: TITLE } })
    expect(whole?.facts).toHaveLength(4)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeThumbnailSet.title]).toBeDefined()
    expect(ja[googleYoutubeThumbnailSet.intent!]).toBeDefined()
    expect(ja["About to set the thumbnail of {title}"]).toContain("{title}")
    expect(ja.From).toBeDefined()
    expect(ja.Type).toBeDefined()
  })
})
