import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePlaylistCreate } from "./playlist-create"
import {
  CHANNEL,
  CHANNELS_URL,
  READ_ONLY_CREDENTIAL,
  cleanUp,
  freshTokens,
  respond,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_playlist_create describe", () => {
  test("headlines the title the call gives, since the playlist does not exist yet", async () => {
    const h = await writeFixture()

    const description = await h.playlistCreate.describe({ title: "Road trip" })

    expect(description.headline).toEqual({
      text: "About to create the playlist {title}",
      values: { title: "Road trip" },
    })
  })

  test("says that the playlist is made private, and shows the description as the text", async () => {
    const h = await writeFixture()

    const description = await h.playlistCreate.describe({ description: "Songs for the car." })

    expect(description.facts).toEqual([{ label: "Privacy", value: { text: "private" } }])
    expect(description.text).toEqual({ label: "Description", body: "Songs for the car." })
  })

  test("shows no text for a playlist without a description", async () => {
    const h = await writeFixture()

    expect((await h.playlistCreate.describe()).text).toBeUndefined()
    expect((await h.playlistCreate.describe({ description: "" })).text).toBeUndefined()
  })

  test("pins the channel the playlist is made in", async () => {
    const h = await writeFixture()

    expect((await h.playlistCreate.describe()).pins).toEqual({ channel: CHANNEL })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubePlaylistCreate, { title: "Road trip" }, h.ctx)

    expect(whole?.headline?.text).toBe("About to create the playlist {title}")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePlaylistCreate.title]).toBeDefined()
    expect(ja[googleYoutubePlaylistCreate.intent!]).toBeDefined()
    expect(ja["About to create the playlist {title}"]).toContain("{title}")
    for (const word of ["Privacy", "Description"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: limits, a label that cannot write, an account with no channel", async () => {
    const h = await writeFixture()
    expect((await toolError(h.playlistCreate.describe({ title: "a".repeat(151) }))).code).toBe("invalid_argument")

    const readOnly = await writeFixture({ credential: READ_ONLY_CREDENTIAL })
    expect((await toolError(readOnly.playlistCreate.describe())).code).toBe("unauthenticated")

    const none = await writeFixture({ handlers: [respond(CHANNELS_URL, { json: { items: [] } })] })
    expect((await toolError(none.playlistCreate.describe())).code).toBe("not_found")
  })
})
