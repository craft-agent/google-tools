import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePrivacySet } from "./privacy"
import {
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  refusal,
  videoHandler,
  videoReplyHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(args: unknown, video: unknown = writableVideo()) {
  const h = await writeFixture({ handlers: [videoHandler(video)] })
  return { h, description: await h.privacy.describe(args) }
}

const PRIVATE = writableVideo({ status: { privacyStatus: "private" } })

describe("google_youtube_privacy_set describe", () => {
  test.each([
    ["public", "About to make {title} public"],
    ["unlisted", "About to make {title} unlisted"],
    ["private", "About to make {title} private"],
  ])("headlines %s with the video's title as Google has it", async (privacy, text) => {
    const { description } = await described({ privacy }, privacy === "private" ? writableVideo() : PRIVATE)

    expect(description.headline).toEqual({ text, values: { title: TITLE } })
  })

  test("headlines a schedule with the title and the time in UTC", async () => {
    const { description } = await described({ publish_at: "2026-12-24T09:00:00+09:00" }, PRIVATE)

    expect(description.headline).toEqual({
      text: "About to schedule {title} for {time}",
      values: { title: TITLE, time: "2026-12-24T00:00:00Z" },
    })
  })

  test("shows who can watch the video now, and a schedule that is set", async () => {
    expect((await described({ privacy: "private" })).description.facts).toEqual([
      { label: "Now", value: { text: "public" } },
    ])
    const scheduled = writableVideo({ status: { privacyStatus: "private", publishAt: "2026-12-24T00:00:00Z" } })
    expect((await described({ privacy: "public" }, scheduled)).description.facts).toEqual([
      { label: "Now", value: { text: "private until {time}", values: { time: "2026-12-24T00:00:00Z" } } },
    ])
    expect((await described({ privacy: "public" }, PRIVATE)).description.facts[0]!.value).toEqual({ text: "private" })
  })

  test("pins every writable property it read, so a video that changed meanwhile gives another pin", async () => {
    const pin = async (video = writableVideo()) => (await described({ privacy: "private" }, video)).description.pins
    const base = await pin()

    expect(base).toEqual({ video: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await pin()).toEqual(base)
    for (const changed of [
      writableVideo({ status: { privacyStatus: "unlisted" } }),
      writableVideo({ status: { embeddable: false } }),
      writableVideo({ snippet: { title: "Renamed" } }),
      writableVideo({ localizations: {} }),
    ]) {
      expect(await pin(changed)).not.toEqual(base)
    }
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubePrivacySet, { video: VIDEO, privacy: "private" }, h.ctx)

    expect(whole?.headline).toEqual({ text: "About to make {title} private", values: { title: TITLE } })
    expect(whole?.facts).toHaveLength(1)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePrivacySet.title]).toBeDefined()
    expect(ja[googleYoutubePrivacySet.intent!]).toBeDefined()
    for (const template of [
      "About to make {title} public",
      "About to make {title} unlisted",
      "About to make {title} private",
      "About to schedule {title} for {time}",
    ]) {
      expect(ja[template]).toContain("{title}")
    }
    expect(ja["About to schedule {title} for {time}"]).toContain("{time}")
    expect(ja.Now).toBeDefined()
  })

  test("throws where execute would: a video that is gone, a call that changes nothing, a time that has passed", async () => {
    const gone = await writeFixture({ handlers: [videoReplyHandler({ json: { items: [] } })] })
    expect((await toolError(gone.privacy.describe({ privacy: "private" }))).code).toBe("not_found")

    const same = await writeFixture()
    expect((await toolError(same.privacy.describe({ privacy: "public" }))).code).toBe("invalid_argument")
    expect((await toolError(same.privacy.describe({ publish_at: "2026-01-01T00:00:00Z" }))).code).toBe(
      "invalid_argument",
    )

    const refused = await writeFixture({ handlers: [videoReplyHandler(refusal(403, "forbidden"))] })
    expect((await toolError(refused.privacy.describe({ privacy: "private" }))).code).toBe("forbidden")
  })
})
