import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubePlaylistEdit } from "./playlist-edit"
import {
  OTHER_CHANNEL,
  PLAYLIST,
  PLAYLIST_TITLE,
  cleanUp,
  freshTokens,
  playlistHandler,
  writablePlaylist,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(playlist: unknown = writablePlaylist(), args: unknown = { title: "New title" }) {
  const h = await writeFixture({ handlers: [playlistHandler(playlist)] })
  return h.playlistEdit.describe(args)
}

describe("google_youtube_playlist_edit describe", () => {
  test("headlines the playlist's title as Google has it, not the call's", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to edit the playlist {title}",
      values: { title: PLAYLIST_TITLE },
    })
  })

  test("shows who can watch the playlist now, the fields that change and their new values", async () => {
    const description = await described(writablePlaylist(), {
      title: "New title",
      description: "Fresh words.",
      set_localizations: { ja: { title: "新タイトル" }, fr: { title: "Un voyage", description: "Des chansons." } },
    })

    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Fields", value: "title, description, localization ja, localization fr" },
    ])
    expect(description.text).toEqual({
      label: "New values",
      body: [
        "title: New title",
        "localization ja: 新タイトル",
        "localization fr: Un voyage",
        "localization fr description: Des chansons.",
        "description: Fresh words.",
      ].join("\n"),
    })
  })

  test("shows a removed language and a description cleared to nothing", async () => {
    const description = await described(writablePlaylist(), { description: "", remove_localizations: ["ja"] })

    expect(description.text?.body).toBe(["localization ja: (removed)", "description: "].join("\n"))
  })

  test("pins the playlist, which changes when its writable properties do and not when its entry count does", async () => {
    const pin = async (playlist = writablePlaylist()) => (await described(playlist)).pins
    const base = await pin()

    expect(base).toEqual({ playlist: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await pin()).toEqual(base)
    expect(await pin(writablePlaylist({ contentDetails: { itemCount: 9 } }))).toEqual(base)
    expect(await pin(writablePlaylist({ snippet: { title: "Renamed" } }))).not.toEqual(base)
    expect(await pin(writablePlaylist({ status: { privacyStatus: "unlisted" } }))).not.toEqual(base)
    expect(await pin(writablePlaylist({ localizations: {} }))).not.toEqual(base)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(
      googleYoutubePlaylistEdit,
      { playlist: PLAYLIST, title: "New title" },
      h.ctx,
    )

    expect(whole?.headline?.text).toBe("About to edit the playlist {title}")
    expect(whole?.text?.body).toBe("title: New title")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubePlaylistEdit.title]).toBeDefined()
    expect(ja[googleYoutubePlaylistEdit.intent!]).toBeDefined()
    expect(ja["About to edit the playlist {title}"]).toContain("{title}")
    for (const word of ["Privacy", "Fields", "New values"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a playlist of another channel, one that is gone, a call with no change", async () => {
    const other = await writeFixture({
      handlers: [playlistHandler(writablePlaylist({ snippet: { channelId: OTHER_CHANNEL } }))],
    })
    expect((await toolError(other.playlistEdit.describe({ title: "x" }))).code).toBe("forbidden")

    const gone = await writeFixture()
    expect((await toolError(gone.playlistEdit.describe({ playlist: "PLnoSuchPlaylist001", title: "x" }))).code).toBe(
      "not_found",
    )

    expect((await toolError(gone.playlistEdit.describe())).code).toBe("invalid_argument")
  })
})
