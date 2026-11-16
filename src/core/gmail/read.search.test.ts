import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { FAKE_ACCESS_TOKEN } from "../google/fake-google.testing"
import {
  MESSAGES_URL,
  answer,
  callOf,
  cleanUp,
  fixture,
  freshTokens,
  headersOf,
  messageUrl,
  type Fixture,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const metadata = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  threadId: `t-${id}`,
  snippet: `Snippet of ${id}`,
  labelIds: ["INBOX"],
  payload: {
    headers: headersOf({
      From: "Ann <ann@example.test>",
      To: "me@example.test",
      Cc: "bo@example.test",
      Subject: `Subject ${id}`,
      Date: "Mon, 1 Jun 2026 09:00:00 +0000",
    }),
  },
  ...extra,
})

/** A fixture whose mailbox holds the messages `ids` and lists them, with the extra list fields given. */
async function mailbox(ids: string[], list: Record<string, unknown> = {}): Promise<Fixture> {
  return fixture([
    answer(MESSAGES_URL, { messages: ids.map((id) => ({ id, threadId: `t-${id}` })), ...list }),
    ...ids.map((id) => answer(messageUrl(id), metadata(id))),
  ])
}

describe("google_gmail_read search", () => {
  test("lists the messages and reads each one's headers, never its body", async () => {
    const h = await mailbox(["m1", "m2"], { nextPageToken: "next-1", resultSizeEstimate: 42 })

    const result = await h.read({ method: "search", query: "from:ann", limit: 2 })

    expect(result).toEqual({
      messages: [
        {
          message_id: "m1",
          thread_id: "t-m1",
          from: "Ann <ann@example.test>",
          to: "me@example.test",
          cc: "bo@example.test",
          subject: "Subject m1",
          date: "Mon, 1 Jun 2026 09:00:00 +0000",
          snippet: "Snippet of m1",
          labels: ["INBOX"],
        },
        expect.objectContaining({ message_id: "m2", subject: "Subject m2" }),
      ],
      next_page_token: "next-1",
      result_size_estimate: 42,
    })
  })

  test("sends the query, the limit, the page token and the spam flag, and asks each message for metadata only", async () => {
    const h = await mailbox(["m1"])

    await h.read({ method: "search", query: "is:unread", limit: 7, page_token: "tok", include_spam_trash: true })

    const [list, get] = h.calls()
    expect(list!.url.searchParams.get("q")).toBe("is:unread")
    expect(list!.url.searchParams.get("maxResults")).toBe("7")
    expect(list!.url.searchParams.get("pageToken")).toBe("tok")
    expect(list!.url.searchParams.get("includeSpamTrash")).toBe("true")
    expect(get!.url.searchParams.get("format")).toBe("metadata")
    expect(get!.url.searchParams.getAll("metadataHeaders")).toEqual(["From", "To", "Cc", "Subject", "Date"])
    expect(get!.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
  })

  test("leaves out what is not given: ten messages, no query, spam and trash excluded", async () => {
    const h = await mailbox([])

    await h.read({ method: "search" })

    const [list] = h.calls()
    expect(list!.url.searchParams.get("maxResults")).toBe("10")
    expect([...list!.url.searchParams.keys()]).toEqual(["maxResults"])
  })

  test("a mailbox with no match is an empty list with no next page", async () => {
    const h = await fixture([answer(MESSAGES_URL, { resultSizeEstimate: 0 })])

    expect(await h.read({ method: "search", query: "nothing" })).toEqual({
      messages: [],
      next_page_token: null,
      result_size_estimate: 0,
    })
    expect(h.calls()).toHaveLength(1)
  })

  test("a header the message lacks is null and a message with no labels has none", async () => {
    const h = await fixture([
      answer(MESSAGES_URL, { messages: [{ id: "m1" }] }),
      answer(messageUrl("m1"), { id: "m1", payload: { headers: headersOf({ Subject: "Only this" }) } }),
    ])

    const result = await h.read({ method: "search" })

    expect(result.messages).toEqual([
      {
        message_id: "m1",
        thread_id: "",
        from: null,
        to: null,
        cc: null,
        subject: "Only this",
        date: null,
        snippet: "",
        labels: [],
      },
    ])
  })

  test("reads at most five messages at a time and keeps the list's order", async () => {
    const ids = Array.from({ length: 12 }, (_value, index) => `m${index}`)
    let running = 0
    let peak = 0
    const h = await fixture([
      answer(MESSAGES_URL, { messages: ids.map((id) => ({ id })) }),
      ...ids.map((id, index) => ({
        method: "GET" as const,
        url: messageUrl(id),
        reply: async () => {
          peak = Math.max(peak, ++running)
          await new Promise((resolve) => setTimeout(resolve, 20 - index))
          running--
          return { json: metadata(id) }
        },
      })),
    ])

    const result = await h.read({ method: "search", limit: 12 })

    expect(result.messages!.map((message) => message.message_id)).toEqual(ids)
    expect(peak).toBe(5)
  })

  test("a message deleted between the list and the read is left out", async () => {
    const h = await fixture([
      answer(MESSAGES_URL, { messages: [{ id: "m1" }, { id: "m2" }] }),
      {
        method: "GET",
        url: messageUrl("m1"),
        reply: { status: 404, json: { error: { code: 404, status: "NOT_FOUND" } } },
      },
      answer(messageUrl("m2"), metadata("m2")),
    ])

    const result = await h.read({ method: "search" })

    expect(result.messages!.map((message) => message.message_id)).toEqual(["m2"])
  })

  test("another failure while reading a message fails the call", async () => {
    const h = await fixture([
      answer(MESSAGES_URL, { messages: [{ id: "m1" }] }),
      { method: "GET", url: messageUrl("m1"), reply: { status: 500, text: "boom" } },
    ])

    await expect(h.read({ method: "search" })).rejects.toMatchObject({ code: "upstream_error" })
  })

  test.each([
    ["a limit over 50", { limit: 51 }],
    ["a limit of 0", { limit: 0 }],
    ["an empty query", { query: "" }],
    ["a query of over 2000 characters", { query: "a".repeat(2001) }],
  ])("%s is invalid_argument and sends nothing", async (_name, more) => {
    const h = await mailbox([])

    await expect(h.read({ method: "search", ...more })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("calls only the list and the message routes", async () => {
    const h = await mailbox(["m1"])

    await h.read({ method: "search" })

    expect(h.calls().map(callOf)).toEqual([`GET ${MESSAGES_URL}`, `GET ${messageUrl("m1")}`])
  })
})
