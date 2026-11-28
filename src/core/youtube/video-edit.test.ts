import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  TITLE,
  VIDEO,
  VIDEOS_URL,
  cleanUp,
  freshTokens,
  updateHandler,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const READS = ["GET https://youtube.googleapis.com/youtube/v3/channels", `GET ${VIDEOS_URL}`]

/** The whole snippet of the made-up video, as an update sends it back. */
const SNIPPET = {
  title: TITLE,
  description: "About made-up things.",
  tags: ["made", "up"],
  categoryId: "22",
  defaultLanguage: "en",
  defaultAudioLanguage: "en",
}

/** The whole status of the made-up video, as an update sends it back: the made-for-kids and synthetic-media flags left out. */
const STATUS = { privacyStatus: "public", license: "youtube", embeddable: true, publicStatsViewable: true }

describe("google_youtube_video_edit", () => {
  test("sends one PUT of the snippet alone, whole as read with the title changed", async () => {
    const h = await writeFixture()

    await h.edit.run({ title: "New title" })

    expect(h.lines()).toEqual([...READS, `PUT ${VIDEOS_URL}`])
    expect(h.calls()[0]!.url.searchParams.get("part")).toBe("id")
    expect(Object.fromEntries(h.calls()[1]!.url.searchParams)).toEqual({
      part: "snippet,status,localizations",
      id: VIDEO,
    })
    const [put] = h.writes()
    expect(Object.fromEntries(put!.url.searchParams)).toEqual({ part: "snippet" })
    expect(put!.json).toEqual({ id: VIDEO, snippet: { ...SNIPPET, title: "New title" } })
  })

  test("merges tags: those removed leave, those added follow in order, a tag it has is not added twice", async () => {
    const h = await writeFixture()

    const result = await h.edit.run({ add_tags: ["fresh", "made", "fresh", "new"], remove_tags: ["up", "absent"] })

    expect(h.writes()[0]!.json).toMatchObject({ snippet: { tags: ["made", "fresh", "new"] } })
    expect(result.changed).toEqual([{ field: "tags", before: ["made", "up"], after: ["made", "fresh", "new"] }])
  })

  test("leaves the tags out of the snippet once all are removed", async () => {
    const h = await writeFixture()

    const result = await h.edit.run({ remove_tags: ["made", "up"] })

    expect(h.writes()[0]!.json).toEqual({ id: VIDEO, snippet: { ...SNIPPET, tags: undefined } })
    expect(h.writes()[0]!.body).not.toContain('"tags"')
    expect(result.changed).toEqual([{ field: "tags", before: ["made", "up"], after: [] }])
  })

  test("sends the whole status, its privacy and schedule as read, and the flags only when set", async () => {
    const scheduled = writableVideo({ status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" } })
    const h = await writeFixture({ handlers: [videoHandler(scheduled)] })

    await h.edit.run({ license: "creativeCommon", embeddable: false })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("status")
    expect(put!.json).toEqual({
      id: VIDEO,
      status: {
        ...STATUS,
        privacyStatus: "private",
        publishAt: "2026-12-24T00:00:00Z",
        license: "creativeCommon",
        embeddable: false,
      },
    })
  })

  test("sends the made-for-kids and synthetic-media flags when the call sets them, and no other", async () => {
    const h = await writeFixture()

    await h.edit.run({ made_for_kids: true, public_stats: false })
    await h.edit.run({ synthetic_media: true, public_stats: false })

    expect(h.writes().map((put) => put.json)).toEqual([
      { id: VIDEO, status: { ...STATUS, publicStatsViewable: false, selfDeclaredMadeForKids: true } },
      { id: VIDEO, status: { ...STATUS, publicStatsViewable: false, containsSyntheticMedia: true } },
    ])
  })

  test("sets the category and the languages in the snippet", async () => {
    const h = await writeFixture()

    await h.edit.run({ category: "27", default_language: "ja", default_audio_language: "fr-CA" })

    expect(h.writes()[0]!.json).toEqual({
      id: VIDEO,
      snippet: { ...SNIPPET, categoryId: "27", defaultLanguage: "ja", defaultAudioLanguage: "fr-CA" },
    })
  })

  test("merges a localization over the language's entry, adds a new one and removes another, sending the whole map", async () => {
    const video = writableVideo({
      localizations: { ja: { title: "日本語", description: "説明" }, de: { title: "Deutsch" } },
    })
    const h = await writeFixture({ handlers: [videoHandler(video)] })

    const result = await h.edit.run({
      set_localizations: { ja: { title: "新しい日本語" }, fr: { title: "Français", description: "Une vidéo." } },
      remove_localizations: ["de"],
    })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("localizations")
    expect(put!.json).toEqual({
      id: VIDEO,
      localizations: {
        ja: { title: "新しい日本語", description: "説明" },
        fr: { title: "Français", description: "Une vidéo." },
      },
    })
    expect(result.changed).toEqual([
      {
        field: "localization ja",
        before: { title: "日本語", description: "説明" },
        after: { title: "新しい日本語", description: "説明" },
      },
      { field: "localization fr", before: null, after: { title: "Français", description: "Une vidéo." } },
      { field: "localization de", before: { title: "Deutsch", description: "" }, after: null },
    ])
  })

  test("a localization is allowed with the default language the call gives for a video that has none", async () => {
    const video = writableVideo({ snippet: { defaultLanguage: undefined }, localizations: {} })
    const h = await writeFixture({ handlers: [videoHandler(video)] })

    await h.edit.run({ default_language: "en", set_localizations: { ja: { title: "日本語" } } })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("snippet,localizations")
    expect(put!.json).toMatchObject({
      snippet: { defaultLanguage: "en" },
      localizations: { ja: { title: "日本語" } },
    })
  })

  test("sends only the parts the call changes, in the order Google lists them", async () => {
    const h = await writeFixture()

    await h.edit.run({ set_localizations: { ja: { title: "別の題" } }, embeddable: false, description: "New." })

    const [put] = h.writes()
    expect(put!.url.searchParams.get("part")).toBe("snippet,status,localizations")
    expect(Object.keys(put!.json as object)).toEqual(["id", "snippet", "status", "localizations"])
  })

  test("a value the call repeats is not sent: only the fields that differ count", async () => {
    const h = await writeFixture()

    const result = await h.edit.run({ title: TITLE, category: "10", embeddable: true })

    expect(result.changed.map((change) => change.field)).toEqual(["category"])
    expect(h.writes()[0]!.url.searchParams.get("part")).toBe("snippet")
  })

  test("returns the video, its privacy now and each field changed as it was and as Google reports it", async () => {
    const h = await writeFixture({
      handlers: [
        updateHandler(() => ({
          json: {
            id: VIDEO,
            snippet: { ...SNIPPET, title: "Title as Google stores it" },
            status: { privacyStatus: "unlisted" },
          },
        })),
      ],
    })

    const result = await h.edit.run({ title: "New title", embeddable: false })

    expect(result).toEqual({
      video_id: VIDEO,
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
      privacy: "unlisted",
      changed: [
        { field: "title", before: TITLE, after: "Title as Google stores it" },
        { field: "embeddable", before: true, after: false },
      ],
    })
  })

  test("takes the video as an address", async () => {
    const h = await writeFixture()

    const result = await h.edit.run({ video: `https://youtu.be/${VIDEO}`, title: "New title" })

    expect(result.video_id).toBe(VIDEO)
  })

  test("the target is the video of the label", async () => {
    const h = await writeFixture()

    expect(await h.edit.targets({ title: "New" })).toEqual([`work/videos/${VIDEO}`])
    expect(await h.edit.targets({ video: "not a video" })).toEqual(["*"])
  })
})
