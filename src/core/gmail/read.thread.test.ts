import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  THREAD_ID,
  answer,
  cleanUp,
  filePart,
  fixture,
  freshTokens,
  fullMessage,
  textPart,
  threadUrl,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** Reads a thread whose messages have the bodies given, in order. */
async function readThread(bodies: string[]) {
  const messages = bodies.map((body, index) => fullMessage(`m${index}`, [textPart("text/plain", body)]))
  const h = await fixture([answer(threadUrl(THREAD_ID), { id: THREAD_ID, messages })])
  const result = await h.read({ method: "thread", thread_id: THREAD_ID })
  return { h, result, messages: result.messages as { body: string; body_truncated: boolean }[] }
}

describe("google_gmail_read thread", () => {
  test("returns every message as `message` does, in the order Gmail gives, and asks for the full format", async () => {
    const h = await fixture([
      answer(threadUrl(THREAD_ID), {
        id: THREAD_ID,
        messages: [
          fullMessage("m0", [textPart("text/plain", "Hello")], { Subject: "Plan", From: "ann@example.test" }),
          fullMessage("m1", [textPart("text/plain", "Hi"), filePart("1", "a.txt", { size: 2 })], {
            Subject: "Re: Plan",
          }),
        ],
      }),
    ])

    const result = await h.read({ method: "thread", thread_id: THREAD_ID })

    expect(result.thread_id).toBe(THREAD_ID)
    expect(result.messages).toEqual([
      expect.objectContaining({
        message_id: "m0",
        subject: "Plan",
        from: "ann@example.test",
        body: "Hello",
        body_format: "text",
        attachments: [],
      }),
      expect.objectContaining({
        message_id: "m1",
        subject: "Re: Plan",
        body: "Hi",
        attachments: [{ part: "1", filename: "a.txt", mime_type: "application/pdf", size: 2 }],
      }),
    ])
    expect(h.calls()[0]!.url.searchParams.get("format")).toBe("full")
  })

  test("a thread with no messages is an empty list", async () => {
    const h = await fixture([answer(threadUrl(THREAD_ID), { id: THREAD_ID })])

    expect(await h.read({ method: "thread", thread_id: THREAD_ID })).toEqual({ thread_id: THREAD_ID, messages: [] })
  })

  test("each body is cut at 20,000 characters", async () => {
    const { messages } = await readThread(["a".repeat(20_001), "short"])

    expect(messages[0]).toMatchObject({ body: "a".repeat(20_000), body_truncated: true })
    expect(messages[1]).toMatchObject({ body: "short", body_truncated: false })
  })

  test("the bodies together are at most 60,000 characters: the one that crosses is cut, the later ones are empty", async () => {
    const { messages } = await readThread(["a".repeat(20_000), "b".repeat(20_000), "c".repeat(25_000), "later", ""])

    expect(messages.map((message) => message.body.length)).toEqual([20_000, 20_000, 20_000, 0, 0])
    expect(messages.map((message) => message.body_truncated)).toEqual([false, false, true, true, false])
  })

  test("a budget spent by earlier messages cuts a later body to what is left", async () => {
    const bodies = ["a".repeat(20_000), "b".repeat(20_000), "c".repeat(19_990), "d".repeat(50)]

    const { messages } = await readThread(bodies)

    expect(messages[2]).toMatchObject({ body_truncated: false })
    expect(messages[3]).toMatchObject({ body: "d".repeat(10), body_truncated: true })
  })
})
