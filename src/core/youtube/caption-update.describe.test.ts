import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ALL_TRANSLATIONS } from "../../words"
import { wholeCallDescription } from "../describe"
import { googleYoutubeCaptionUpdate } from "./caption-update"
import { SRT } from "./caption.testing"
import {
  TITLE,
  TRACK,
  TRACK_DRAFT,
  VIDEO,
  captionTrack,
  captionsHandler,
  cleanUp,
  freshTokens,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const HASH = expect.stringMatching(/^[0-9a-f]{64}$/)

describe("google_youtube_caption_update describe", () => {
  test("headlines a replaced file, and shows privacy, the draft state now and after, the track, the file and its text", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })
    const path = join(h.uploadDir, "en.srt")

    const description = await h.captionUpdate.describe({ path })

    expect(description.headline).toEqual({
      text: "About to replace the {language} captions of {title}",
      values: { language: "en", title: TITLE },
    })
    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Draft now", value: { text: "no" } },
      { label: "Draft after", value: { text: "no" } },
      { label: "Track", value: "English" },
      { label: "Updated", value: "2026-03-05T08:00:00Z" },
      { label: "From", value: path },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: Buffer.byteLength(SRT) } } },
    ])
    expect(description.text).toEqual({ label: "Captions", body: SRT })
  })

  test("headlines a track published, with no file facts and no text", async () => {
    const h = await writeFixture()

    const description = await h.captionUpdate.describe({ caption: TRACK_DRAFT, draft: false })

    expect(description.headline).toEqual({
      text: "About to publish the {language} captions of {title}",
      values: { language: "ja", title: TITLE },
    })
    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Draft now", value: { text: "yes, viewers do not see it" } },
      { label: "Draft after", value: { text: "no" } },
      { label: "Track", value: "日本語" },
      { label: "Updated", value: "2026-03-05T08:00:00Z" },
    ])
    expect(description.text).toBeUndefined()
  })

  test("headlines a track made a draft", async () => {
    const h = await writeFixture()

    const description = await h.captionUpdate.describe({ draft: true })

    expect(description.headline).toEqual({
      text: "About to make the {language} captions of {title} a draft",
      values: { language: "en", title: TITLE },
    })
    expect(description.facts[2]).toEqual({ label: "Draft after", value: { text: "yes, viewers do not see it" } })
  })

  test("a file replaces the file even when the draft state changes too, and the draft state after follows the call", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    const description = await h.captionUpdate.describe({ path: join(h.uploadDir, "en.srt"), draft: true })

    expect(description.headline?.text).toBe("About to replace the {language} captions of {title}")
    expect(description.facts[1]).toEqual({ label: "Draft now", value: { text: "no" } })
    expect(description.facts[2]).toEqual({ label: "Draft after", value: { text: "yes, viewers do not see it" } })
  })

  test("a track with no name or update time shows empty values, and a draft state Google left out is not a draft", async () => {
    const h = await writeFixture({ handlers: [captionsHandler({ id: TRACK })] })

    const { facts } = await h.captionUpdate.describe({ draft: true })

    expect(facts).toContainEqual({ label: "Draft now", value: { text: "no" } })
    expect(facts).toContainEqual({ label: "Track", value: "" })
    expect(facts).toContainEqual({ label: "Updated", value: "" })
  })

  test("pins the file's content, the video and the track, and each changes with what it holds", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })
    const path = join(h.uploadDir, "en.srt")
    const base = (await h.captionUpdate.describe({ path })).pins

    expect(base).toEqual({ content: HASH, video: HASH, track: HASH })
    expect((await h.captionUpdate.describe({ path })).pins).toEqual(base)

    await writeFile(path, `${SRT}3\n`)
    const changedFile = (await h.captionUpdate.describe({ path })).pins
    expect(changedFile?.content).not.toBe(base?.content)
    expect(changedFile?.video).toBe(base?.video)
    expect(changedFile?.track).toBe(base?.track)

    const renamed = await writeFixture({
      files: { "en.srt": SRT },
      handlers: [videoHandler(writableVideo({ snippet: { title: "Renamed" } }))],
    })
    const changedVideo = (await renamed.captionUpdate.describe({ path: join(renamed.uploadDir, "en.srt") })).pins
    expect(changedVideo?.video).not.toBe(base?.video)
    expect(changedVideo?.track).toBe(base?.track)

    const edited = await writeFixture({
      files: { "en.srt": SRT },
      handlers: [captionsHandler(captionTrack(TRACK, { lastUpdated: "2026-03-09T00:00:00Z" }))],
    })
    const changedTrack = (await edited.captionUpdate.describe({ path: join(edited.uploadDir, "en.srt") })).pins
    expect(changedTrack?.track).not.toBe(base?.track)
    expect(changedTrack?.video).toBe(base?.video)
    expect(changedTrack?.content).toBe(base?.content)
  })

  test("pins no content when no file goes", async () => {
    const h = await writeFixture()

    expect((await h.captionUpdate.describe({ draft: true })).pins).toEqual({ video: HASH, track: HASH })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    const whole = await wholeCallDescription(
      googleYoutubeCaptionUpdate,
      { video: VIDEO, caption: TRACK, path: join(h.uploadDir, "en.srt") },
      h.ctx,
    )

    expect(whole?.headline?.text).toBe("About to replace the {language} captions of {title}")
    expect(whole?.facts).toHaveLength(7)
    expect(whole?.text?.label).toBe("Captions")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeCaptionUpdate.title]).toBeDefined()
    expect(ja[googleYoutubeCaptionUpdate.intent!]).toBeDefined()
    for (const word of [
      "About to replace the {language} captions of {title}",
      "About to publish the {language} captions of {title}",
      "About to make the {language} captions of {title} a draft",
    ]) {
      expect(ja[word]).toContain("{language}")
    }
    expect(ja["Draft now"]).toBeDefined()
    expect(ja["Draft after"]).toBeDefined()
    expect(ja.Track).toBeDefined()
    expect(ja.Updated).toBeDefined()
  })
})
