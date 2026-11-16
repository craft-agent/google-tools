import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  DRAFTS_URL,
  DRAFT_CREDENTIAL,
  DRAFT_HEADERS,
  DRAFT_ID,
  DRAFT_MESSAGE_ID,
  draftFull,
  draftMetadata,
  draftUrl,
} from "./draft.testing"
import { THREAD_ID, answer, callOf, cleanUp, filePart, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const listed = (ids: string[], extra: Record<string, unknown> = {}) =>
  answer(DRAFTS_URL, { drafts: ids.map((id) => ({ id, message: { id: `m-${id}`, threadId: THREAD_ID } })), ...extra })

describe("google_gmail_read drafts", () => {
  test("lists the drafts and reads each one's headers, never its body", async () => {
    const h = await fixture([
      listed([DRAFT_ID, "r-2"], { nextPageToken: "next-1" }),
      answer(draftUrl(DRAFT_ID), draftMetadata({ ...DRAFT_HEADERS, Cc: "bo@example.test" })),
      answer(draftUrl("r-2"), draftMetadata({ Subject: "Second" }, "m-2", "r-2")),
    ])

    const result = await h.read({ method: "drafts", query: "lunch", limit: 2 })

    expect(result).toEqual({
      drafts: [
        {
          draft_id: DRAFT_ID,
          message_id: DRAFT_MESSAGE_ID,
          thread_id: THREAD_ID,
          to: "Ann <ann@example.test>",
          cc: "bo@example.test",
          bcc: null,
          subject: "Lunch plans",
          date: "Mon, 1 Jun 2026 09:00:00 +0000",
          snippet: "Are we still on",
        },
        {
          draft_id: "r-2",
          message_id: "m-2",
          thread_id: THREAD_ID,
          to: null,
          cc: null,
          bcc: null,
          subject: "Second",
          date: null,
          snippet: "Are we still on",
        },
      ],
      next_page_token: "next-1",
    })
    const [list, first] = h.calls()
    expect(callOf(list!)).toBe(`GET ${DRAFTS_URL}`)
    expect(list!.url.searchParams.get("q")).toBe("lunch")
    expect(list!.url.searchParams.get("maxResults")).toBe("2")
    expect(first!.url.searchParams.get("format")).toBe("metadata")
    expect(first!.url.searchParams.getAll("metadataHeaders")).toEqual(["To", "Cc", "Bcc", "Subject", "Date"])
  })

  test("asks for 10 drafts by default, passes the page token on and ends with a null token", async () => {
    const h = await fixture([listed([])])
    expect(await h.read({ method: "drafts", page_token: "p-2" })).toEqual({ drafts: [], next_page_token: null })
    const [list] = h.calls()
    expect(list!.url.searchParams.get("maxResults")).toBe("10")
    expect(list!.url.searchParams.get("pageToken")).toBe("p-2")
    expect(list!.url.searchParams.has("q")).toBe(false)
  })

  test("an account with no drafts has none listed even when Google leaves the list out", async () => {
    const h = await fixture([answer(DRAFTS_URL, { resultSizeEstimate: 0 })])
    expect(await h.read({ method: "drafts" })).toEqual({ drafts: [], next_page_token: null })
  })

  test("leaves out a draft that was deleted between the list and the read", async () => {
    const h = await fixture([
      listed([DRAFT_ID, "r-gone"]),
      answer(draftUrl(DRAFT_ID), draftMetadata()),
      { method: "GET", url: draftUrl("r-gone"), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
    ])
    const result = await h.read({ method: "drafts" })
    expect(result.drafts?.map((draft) => draft.draft_id)).toEqual([DRAFT_ID])
  })

  test("a label that may only compose can list and read drafts", async () => {
    const h = await fixture([listed([DRAFT_ID]), answer(draftUrl(DRAFT_ID), draftMetadata())], DRAFT_CREDENTIAL)
    expect((await h.read({ method: "drafts" })).drafts).toHaveLength(1)
  })

  test("takes no draft_id, and limits of 1 to 50", async () => {
    const h = await fixture([])
    expect((await toolError(h.read({ method: "drafts", draft_id: DRAFT_ID }))).message).toContain("draft_id")
    expect((await toolError(h.read({ method: "drafts", limit: 51 }))).code).toBe("invalid_argument")
    expect((await toolError(h.read({ method: "search", draft_id: DRAFT_ID }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_gmail_read draft", () => {
  test("returns the draft's message as a message is, with the draft's id", async () => {
    const attachment = filePart("1", "plan.pdf", { size: 2048, attachmentId: "att-1" })
    const h = await fixture([
      answer(
        draftUrl(DRAFT_ID),
        draftFull({ ...DRAFT_HEADERS, Cc: "bo@example.test", Bcc: "dee@example.test" }, "Hello", [attachment]),
      ),
    ])

    const result = await h.read({ method: "draft", draft_id: DRAFT_ID })

    expect(result).toMatchObject({
      draft_id: DRAFT_ID,
      message_id: DRAFT_MESSAGE_ID,
      thread_id: THREAD_ID,
      to: "Ann <ann@example.test>",
      cc: "bo@example.test",
      bcc: "dee@example.test",
      subject: "Lunch plans",
      body: "Hello",
      body_format: "text",
      body_truncated: false,
      attachments: [{ part: "1", filename: "plan.pdf", mime_type: "application/pdf", size: 2048 }],
    })
    const [request] = h.calls()
    expect(callOf(request!)).toBe(`GET ${draftUrl(DRAFT_ID)}`)
    expect(request!.url.searchParams.get("format")).toBe("full")
  })

  test("cuts the body at 20,000 characters like a message", async () => {
    const h = await fixture([answer(draftUrl(DRAFT_ID), draftFull(undefined, "x".repeat(20_001)))])
    const result = await h.read({ method: "draft", draft_id: DRAFT_ID })
    expect([result.body?.length, result.body_truncated]).toEqual([20_000, true])
  })

  test("needs a draft_id that is an id, and a draft that exists", async () => {
    const h = await fixture([
      { method: "GET", url: draftUrl("r-gone"), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
    ])
    expect((await toolError(h.read({ method: "draft" }))).message).toContain("draft_id")
    expect((await toolError(h.read({ method: "draft", draft_id: "../x" }))).code).toBe("invalid_argument")
    expect((await toolError(h.read({ method: "draft", draft_id: "r-gone" }))).code).toBe("not_found")
  })

  test("a draft Google gives with no message is an upstream error", async () => {
    const h = await fixture([answer(draftUrl(DRAFT_ID), { id: DRAFT_ID })])
    expect((await toolError(h.read({ method: "draft", draft_id: DRAFT_ID }))).code).toBe("upstream_error")
  })
})
