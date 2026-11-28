import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeVideoEdit } from "./video-edit"
import {
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  refusal,
  videoReplyHandler,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(args: unknown, video: unknown = writableVideo()) {
  const h = await writeFixture({ handlers: [videoHandler(video)] })
  return { h, description: await h.edit.describe(args) }
}

describe("google_youtube_video_edit describe", () => {
  test("headlines the video with its title as Google has it, not as the call names it", async () => {
    const { description } = await described({ title: "New title" })

    expect(description.headline).toEqual({ text: "About to edit {title}", values: { title: TITLE } })
  })

  test("shows who can watch the video now, then the fields that change", async () => {
    const { description } = await described({ title: "New title", add_tags: ["new"], embeddable: false })

    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Fields", value: "title, tags, embeddable" },
    ])
  })

  test("says private until a time for a scheduled video, and the other privacies as they are", async () => {
    const scheduled = await described(
      { title: "New" },
      writableVideo({ status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" } }),
    )
    expect(scheduled.description.facts[0]).toEqual({
      label: "Privacy",
      value: { text: "private until {time}", values: { time: "2026-12-24T00:00:00Z" } },
    })

    for (const privacy of ["unlisted", "private"]) {
      const { description } = await described({ title: "New" }, writableVideo({ status: { privacyStatus: privacy } }))
      expect(description.facts[0]).toEqual({ label: "Privacy", value: { text: privacy } })
    }
  })

  test("lists the new values a line each, the description last", async () => {
    const { description } = await described({
      description: "Line one.\nLine two.",
      title: "New title",
      add_tags: ["new"],
      remove_tags: ["up"],
      category: "27",
      default_language: "ja",
      made_for_kids: true,
      license: "creativeCommon",
      set_localizations: { ja: { title: "新しい題", description: "新しい説明" }, fr: { title: "Titre" } },
    })

    expect(description.text).toEqual({
      label: "New values",
      body: [
        "title: New title",
        "tags: made, new",
        "category: 27",
        "default language: ja",
        "license: creativeCommon",
        "made for kids: yes",
        "localization ja: 新しい題",
        "localization ja description: 新しい説明",
        "localization fr: Titre",
        "description: Line one.\nLine two.",
      ].join("\n"),
    })
  })

  test("says a removed localization and an emptied tag list as such", async () => {
    const { description } = await described({ remove_tags: ["made", "up"], remove_localizations: ["ja"] })

    expect(description.text?.body).toBe(["tags: (none)", "localization ja: (removed)"].join("\n"))
  })

  test("pins every writable property it read, so a video that changed meanwhile gives another pin", async () => {
    const pin = async (video = writableVideo()) => (await described({ title: "New title" }, video)).description.pins
    const base = await pin()

    expect(base).toEqual({ video: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await pin()).toEqual(base)
    for (const changed of [
      writableVideo({ snippet: { title: "Renamed" } }),
      writableVideo({ snippet: { tags: ["made"] } }),
      writableVideo({ snippet: { categoryId: "10" } }),
      writableVideo({ status: { privacyStatus: "unlisted" } }),
      writableVideo({ status: { embeddable: false } }),
      writableVideo({ status: { selfDeclaredMadeForKids: true } }),
      writableVideo({ localizations: {} }),
      writableVideo({ localizations: { ja: { title: "別" } } }),
    ]) {
      expect(await pin(changed)).not.toEqual(base)
    }
  })

  test("a field Google reports that no update sends does not move the pin", async () => {
    const pin = async (video: unknown) => (await described({ title: "New title" }, video)).description.pins
    const base = writableVideo()

    expect(
      await pin(writableVideo({ snippet: { channelTitle: "Renamed channel" }, status: { madeForKids: true } })),
    ).toEqual(await pin(base))
  })

  test("is a description the prompt can use, and the same for the same call", async () => {
    const h = await writeFixture()
    const args = { video: VIDEO, title: "New title" }

    const whole = await wholeCallDescription(googleYoutubeVideoEdit, args, h.ctx)

    expect(whole?.headline?.values).toEqual({ title: TITLE })
    expect(whole).toEqual(await wholeCallDescription(googleYoutubeVideoEdit, args, h.ctx))
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeVideoEdit.title]).toBeDefined()
    expect(ja[googleYoutubeVideoEdit.intent!]).toBeDefined()
    expect(ja["About to edit {title}"]).toContain("{title}")
    expect(ja["private until {time}"]).toContain("{time}")
    expect(ja.Fields).toBeDefined()
    expect(ja["New values"]).toBeDefined()
  })

  test("throws where execute would: a video that is gone, an edit that changes nothing", async () => {
    const gone = await writeFixture({ handlers: [videoReplyHandler({ json: { items: [] } })] })
    expect((await toolError(gone.edit.describe({ title: "New" }))).code).toBe("not_found")

    const same = await writeFixture()
    expect((await toolError(same.edit.describe({ title: TITLE }))).code).toBe("invalid_argument")

    const refused = await writeFixture({ handlers: [videoReplyHandler(refusal(403, "forbidden"))] })
    expect((await toolError(refused.edit.describe({ title: "New" }))).code).toBe("forbidden")
  })
})
