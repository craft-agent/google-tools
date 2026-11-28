import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ALL_TRANSLATIONS } from "../../words"
import { wholeCallDescription } from "../describe"
import { googleYoutubeCaptionAdd } from "./caption-add"
import { LATIN1_SRT, SRT } from "./caption.testing"
import {
  TITLE,
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

const FILES = { "en.srt": SRT, "latin.srt": LATIN1_SRT, "empty.srt": "" }

describe("google_youtube_caption_add describe", () => {
  test("headlines the language and the video's title and shows privacy, draft state, the tracks there, the file and its text", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "en.srt")

    const description = await h.captionAdd.describe({ path })

    expect(description.headline).toEqual({
      text: "About to add {language} captions to {title}",
      values: { language: "en", title: TITLE },
    })
    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Draft", value: { text: "no" } },
      { label: "In this language", value: { text: "{count} tracks", values: { count: 2 } } },
      { label: "From", value: path },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: Buffer.byteLength(SRT) } } },
    ])
    expect(description.text).toEqual({ label: "Captions", body: SRT })
  })

  test("says a draft is not seen by viewers, and counts one track as one", async () => {
    const h = await writeFixture({ files: FILES, handlers: [captionsHandler(captionTrack("cap_only_0001"))] })

    const { facts } = await h.captionAdd.describe({ path: join(h.uploadDir, "en.srt"), draft: true })

    expect(facts[1]).toEqual({ label: "Draft", value: { text: "yes, viewers do not see it" } })
    expect(facts[2]).toEqual({ label: "In this language", value: { text: "{count} track", values: { count: 1 } } })
  })

  test("counts the tracks of the language asked for, whatever their names, and none of another", async () => {
    const h = await writeFixture({ files: FILES })

    const [, , japanese] = (await h.captionAdd.describe({ path: join(h.uploadDir, "en.srt"), language: "ja" })).facts
    const [, , german] = (await h.captionAdd.describe({ path: join(h.uploadDir, "en.srt"), language: "de" })).facts

    expect(japanese).toEqual({ label: "In this language", value: { text: "{count} track", values: { count: 1 } } })
    expect(german).toEqual({ label: "In this language", value: { text: "{count} tracks", values: { count: 0 } } })
  })

  test("shows what a file that is not valid UTF-8 decodes to, and no text for an empty file", async () => {
    const h = await writeFixture({ files: FILES })

    const latin = await h.captionAdd.describe({ path: join(h.uploadDir, "latin.srt") })
    const empty = await h.captionAdd.describe({ path: join(h.uploadDir, "empty.srt") })

    expect(latin.text?.body).toContain("caf\uFFFD")
    expect(empty.text).toBeUndefined()
  })

  test("pins the file's content and the video, and a file or a video that changed gives another pin", async () => {
    const h = await writeFixture({ files: FILES })
    const path = join(h.uploadDir, "en.srt")
    const base = (await h.captionAdd.describe({ path })).pins

    expect(base).toEqual({
      content: expect.stringMatching(/^[0-9a-f]{64}$/),
      video: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect((await h.captionAdd.describe({ path })).pins).toEqual(base)

    await writeFile(path, `${SRT}3\n`)
    const changedFile = (await h.captionAdd.describe({ path })).pins
    expect(changedFile?.content).not.toBe(base?.content)
    expect(changedFile?.video).toBe(base?.video)

    const renamed = await writeFixture({
      files: FILES,
      handlers: [videoHandler(writableVideo({ snippet: { title: "Renamed" } }))],
    })
    const changedVideo = (await renamed.captionAdd.describe({ path: join(renamed.uploadDir, "en.srt") })).pins
    expect(changedVideo?.video).not.toBe(base?.video)
    expect(changedVideo?.content).toBe(base?.content)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ files: FILES })

    const whole = await wholeCallDescription(
      googleYoutubeCaptionAdd,
      { video: VIDEO, language: "en", path: join(h.uploadDir, "en.srt") },
      h.ctx,
    )

    expect(whole?.headline).toEqual({
      text: "About to add {language} captions to {title}",
      values: { language: "en", title: TITLE },
    })
    expect(whole?.facts).toHaveLength(5)
    expect(whole?.text?.label).toBe("Captions")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeCaptionAdd.title]).toBeDefined()
    expect(ja[googleYoutubeCaptionAdd.intent!]).toBeDefined()
    expect(ja["About to add {language} captions to {title}"]).toContain("{language}")
    expect(ja.Draft).toBeDefined()
    expect(ja.Captions).toBeDefined()
    expect(ja["In this language"]).toBeDefined()
  })
})
