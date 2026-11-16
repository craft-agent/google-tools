import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { GMAIL_MODIFY_SCOPE } from "./scopes"
import {
  LABELS_URL,
  MESSAGES_URL,
  MESSAGE_ID,
  THREAD_ID,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  fullMessage,
  messageUrl,
  textPart,
  threadUrl,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CALLS = [
  ["search", { method: "search" }],
  ["message", { method: "message", message_id: MESSAGE_ID }],
  ["thread", { method: "thread", thread_id: THREAD_ID }],
  ["labels", { method: "labels" }],
  ["attachment", { method: "attachment", message_id: MESSAGE_ID, part: "1" }],
] as const

const failing = (url: string, status: number, error: Record<string, unknown>): FakeHandler => ({
  method: "GET",
  url,
  reply: { status, json: { error } },
})

describe("google_gmail_read: the label's scopes", () => {
  test.each(CALLS)(
    "%s fails as unauthenticated, before any request, for a label logged in for account only",
    async (_method, args) => {
      const h = await fixture([], CREDENTIAL)

      const error = await toolError(h.read(args))

      expect(error).toMatchObject({ code: "unauthenticated" })
      expect(error.message).toContain("was not logged in with a scope this call needs")
      expect(error.message).toContain("login --account work --toolsets account,gmail")
      expect(error.message).not.toContain("--read-only")
      expect(error.details?.needs).toEqual([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
      ])
      expect(h.requests).toEqual([])
    },
  )

  test("a label logged in for sheets alone holds no mail scope", async () => {
    const h = await fixture([], {
      ...CREDENTIAL,
      scopes: [...CREDENTIAL.scopes, "https://www.googleapis.com/auth/spreadsheets"],
    })

    await expect(h.read({ method: "labels" })).rejects.toMatchObject({ code: "unauthenticated" })
    expect(h.requests).toEqual([])
  })

  test("the modify scope alone reads too", async () => {
    const h = await fixture([answer(LABELS_URL, {})], {
      ...CREDENTIAL,
      scopes: [...CREDENTIAL.scopes, GMAIL_MODIFY_SCOPE],
    })

    expect(await h.read({ method: "labels" })).toEqual({ labels: [] })
  })
})

describe("google_gmail_read: Google's refusals", () => {
  test("a message that does not exist is not_found", async () => {
    const h = await fixture([
      failing(messageUrl(MESSAGE_ID), 404, {
        code: 404,
        message: "Requested entity was not found.",
        status: "NOT_FOUND",
      }),
    ])

    await expect(h.read({ method: "message", message_id: MESSAGE_ID })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("Requested entity was not found."),
    })
  })

  test("a thread that does not exist is not_found", async () => {
    const h = await fixture([failing(threadUrl(THREAD_ID), 404, { code: 404, status: "NOT_FOUND" })])

    await expect(h.read({ method: "thread", thread_id: THREAD_ID })).rejects.toMatchObject({ code: "not_found" })
  })

  test("a rate limit is rate_limited", async () => {
    const h = await fixture([failing(MESSAGES_URL, 429, { code: 429, status: "RESOURCE_EXHAUSTED" })])

    await expect(h.read({ method: "search" })).rejects.toMatchObject({ code: "rate_limited" })
  })

  test("a reply that is not a message is upstream_error", async () => {
    const h = await fixture([answer(messageUrl(MESSAGE_ID), { payload: "none" })])

    await expect(h.read({ method: "message", message_id: MESSAGE_ID })).rejects.toMatchObject({
      code: "upstream_error",
      message: "Google's reply to a message was not in the expected shape.",
    })
  })
})

describe("google_gmail_read: the arguments", () => {
  test.each([
    ["a path in a message id", "../labels"],
    ["a slash", "abc/def"],
    ["a space", "abc def"],
    ["a query", "abc?format=raw"],
    ["an empty id", ""],
    ["an id of 201 characters", "a".repeat(201)],
  ])("%s is invalid_argument and sends nothing", async (_name, id) => {
    const h = await fixture([answer(messageUrl(MESSAGE_ID), fullMessage(MESSAGE_ID, [textPart("text/plain", "x")]))])

    for (const args of [
      { method: "message", message_id: id },
      { method: "thread", thread_id: id },
      { method: "attachment", message_id: id, part: "1" },
    ]) {
      await expect(h.read(args)).rejects.toMatchObject({ code: "invalid_argument" })
    }
    expect(h.requests).toEqual([])
  })

  test.each([
    ["message without its id", { method: "message" }, "Method message needs `message_id`."],
    ["thread without its id", { method: "thread" }, "Method thread needs `thread_id`."],
    ["attachment without a part", { method: "attachment", message_id: MESSAGE_ID }, "Method attachment needs `part`."],
    ["labels with a query", { method: "labels", query: "x" }, "Method labels takes no `query`."],
    ["search with a message id", { method: "search", message_id: MESSAGE_ID }, "Method search takes no `message_id`."],
    [
      "message with a part",
      { method: "message", message_id: MESSAGE_ID, part: "1" },
      "Method message takes no `part`.",
    ],
    ["thread with a name", { method: "thread", thread_id: THREAD_ID, name: "x" }, "Method thread takes no `name`."],
  ])("%s is invalid_argument", async (_name, args, message) => {
    const h = await fixture([])

    await expect(h.read(args)).rejects.toMatchObject({ code: "invalid_argument", message })
    expect(h.requests).toEqual([])
  })

  test("an argument no method has is refused", async () => {
    const h = await fixture([])

    await expect(h.read({ method: "labels", format: "raw" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ method: "send" })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})
