import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { YOUTUBE_SCOPE } from "./scopes"
import {
  CAPTIONS_URL,
  READ_ONLY_CREDENTIAL,
  VIDEO,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  refusal,
  respond,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const track = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    language: "en",
    name: "English",
    trackKind: "standard",
    isDraft: false,
    status: "serving",
    lastUpdated: "2026-03-05T08:00:00Z",
    ...extra,
  },
})

describe("google_youtube_read captions", () => {
  test("lists the tracks of a video with one call, the address as good as the id", async () => {
    const h = await fixture([answer(CAPTIONS_URL, { items: [] })])

    await h.read({ method: "captions", video: `https://youtu.be/${VIDEO}` })

    expect(h.calls()).toHaveLength(1)
    expect(queryOf(h)).toEqual({ part: "snippet", videoId: VIDEO })
  })

  test("returns each track as a view, the automatic one told by its kind", async () => {
    const h = await fixture([
      answer(CAPTIONS_URL, {
        items: [
          track("cap1"),
          track("cap2", { language: "ja", name: "", trackKind: "asr", isDraft: true }),
          { id: "cap3" },
        ],
      }),
    ])

    expect(await h.read({ method: "captions", video: VIDEO })).toEqual({
      video_id: VIDEO,
      tracks: [
        {
          caption_id: "cap1",
          language: "en",
          name: "English",
          kind: "standard",
          draft: false,
          status: "serving",
          updated_at: "2026-03-05T08:00:00Z",
        },
        {
          caption_id: "cap2",
          language: "ja",
          name: "",
          kind: "asr",
          draft: true,
          status: "serving",
          updated_at: "2026-03-05T08:00:00Z",
        },
        { caption_id: "cap3", language: null, name: null, kind: null, draft: null, status: null, updated_at: null },
      ],
    })
  })

  test("a video with no tracks gives an empty list", async () => {
    const h = await fixture([answer(CAPTIONS_URL, {})])

    expect(await h.read({ method: "captions", video: VIDEO })).toEqual({ video_id: VIDEO, tracks: [] })
  })

  test("a label logged in with --read-only is refused before any call, with the login that adds force-ssl", async () => {
    const h = await fixture([answer(CAPTIONS_URL, { items: [] })], READ_ONLY_CREDENTIAL)

    const error = await toolError(h.read({ method: "captions", video: VIDEO }))

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toMatch(/login --account work --toolsets [^ ]*\byoutube\b/)
    expect(error.message).not.toContain("--read-only")
    expect(error.details?.needs).toEqual([YOUTUBE_SCOPE])
    expect(h.requests).toEqual([])
  })

  test("a 403 forbidden reason stays forbidden, with Google's message and details", async () => {
    const h = await fixture([
      respond(
        CAPTIONS_URL,
        refusal(
          403,
          "forbidden",
          "The permissions associated with the request are not sufficient to retrieve the caption track.",
        ),
      ),
    ])

    const error = await toolError(h.read({ method: "captions", video: VIDEO }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(
      "The permissions associated with the request are not sufficient to retrieve the caption track.",
    )
    expect(error.details).toEqual({ status: 403, reason: "forbidden" })
  })

  test("a spent quota stays rate_limited", async () => {
    const spent = await fixture([respond(CAPTIONS_URL, refusal(403, "quotaExceeded"))])
    expect(await toolError(spent.read({ method: "captions", video: VIDEO }))).toMatchObject({ code: "rate_limited" })
  })

  test("a video that does not exist is not_found", async () => {
    const h = await fixture([respond(CAPTIONS_URL, refusal(404, "videoNotFound"))])

    await expect(h.read({ method: "captions", video: VIDEO })).rejects.toMatchObject({ code: "not_found" })
  })

  test.each([
    ["no video", { method: "captions" }, "Method captions needs `video`."],
    ["a thread", { method: "captions", video: VIDEO, thread: "UgxA" }, "Method captions takes no `thread`."],
    ["a limit", { method: "captions", video: VIDEO, limit: 5 }, "Method captions takes no `limit`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, args, message) => {
    const h = await fixture([])

    await expect(h.read(args)).rejects.toMatchObject({ code: "invalid_argument", message })
    expect(h.requests).toEqual([])
  })

  test("a video that is no video is invalid_argument, and sends nothing", async () => {
    const h = await fixture([])

    await expect(h.read({ method: "captions", video: "short" })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
