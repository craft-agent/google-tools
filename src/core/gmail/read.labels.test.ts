import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { LABELS_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_gmail_read labels", () => {
  test("lists the labels with their type, and the counts where Google gives them", async () => {
    const h = await fixture([
      answer(LABELS_URL, {
        labels: [
          { id: "INBOX", name: "INBOX", type: "system", messageListVisibility: "hide" },
          { id: "Label_12", name: "Receipts/2026", type: "user", messagesTotal: 40, messagesUnread: 3 },
          { id: "Label_13", name: "Odd", type: "somethingNew" },
        ],
      }),
    ])

    const result = await h.read({ method: "labels" })

    expect(result).toEqual({
      labels: [
        { label_id: "INBOX", name: "INBOX", type: "system" },
        { label_id: "Label_12", name: "Receipts/2026", type: "user", messages_total: 40, messages_unread: 3 },
        { label_id: "Label_13", name: "Odd", type: "user" },
      ],
    })
    expect(h.calls()).toHaveLength(1)
    expect(h.calls()[0]!.url.search).toBe("")
  })

  test("a mailbox with no label list is an empty list", async () => {
    const h = await fixture([answer(LABELS_URL, {})])

    expect(await h.read({ method: "labels" })).toEqual({ labels: [] })
  })

  test("a reply that is not a label list is upstream_error", async () => {
    const h = await fixture([answer(LABELS_URL, { labels: "none" })])

    await expect(h.read({ method: "labels" })).rejects.toMatchObject({
      code: "upstream_error",
      message: "Google's reply to the label list was not in the expected shape.",
    })
  })
})
