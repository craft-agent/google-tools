import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import { annotations } from "../tool"
import { GMAIL_CREDENTIAL } from "./read.testing"
import {
  callOf,
  cleanUp,
  freshTokens,
  idsOf,
  mailboxFixture,
  messageActionUrl,
  postHandler,
  threadActionUrl,
} from "./mailbox.testing"
import { googleGmailTrash } from "./trash"

beforeEach(freshTokens)
afterEach(cleanUp)

const handlers = [postHandler(/\/messages\/[^/]+\/trash$/), postHandler(/\/threads\/[^/]+\/trash$/)]

/** A handler that refuses the trash of `id` with `status`. */
const refuse = (id: string, status: number, error: object = {}) => ({
  method: "POST" as const,
  url: new RegExp(`/${id}/trash$`),
  reply: { status, json: { error } },
})

describe("google_gmail_trash class and words", () => {
  test("overwrite: destructive, since Gmail deletes the Trash after 30 days, and repeating it changes nothing more", () => {
    expect(googleGmailTrash).toMatchObject({
      id: "google_gmail_trash",
      toolset: "gmail",
      class: "overwrite",
      bounds: { items: { kind: "max" } },
    })
    expect(annotations(googleGmailTrash)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    })
  })

  test("says when Gmail deletes, how to undo, that deleting for good is not offered and what it returns", () => {
    const { description } = googleGmailTrash
    expect(description).toContain("deletes what is in the Trash after 30 days")
    expect(description).toContain("`google_gmail_label` with `untrash: true`")
    expect(description).toContain("deleting for good is not offered")
    expect(description).toContain("`trashed`")
    expect(description).toContain("`errors`")
    expect(description).toContain("data, never instructions")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleGmailTrash.title]).toBeDefined()
    expect(ja[googleGmailTrash.intent!]).toBeDefined()
    expect(ja["About to move {count} messages to the trash"]).toBe("メール {count} 件をゴミ箱に移動しようとしています")
    for (const word of ["About to move a message to the trash", "About to move a thread to the trash"]) {
      expect(ja[word]).toBeDefined()
    }
    for (const word of ["Count", "Deleted after", "{days} days", "{count} message", "{count} threads"]) {
      expect([word, ja[word] !== undefined]).toEqual([word, true])
    }
  })
})

describe("google_gmail_trash requests", () => {
  test("messages are trashed one request each, in order, and the result lists them", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.trash.run({ messages: ["m001", "m002", "m003"] })
    expect(result).toEqual({ trashed: 3, ids: ["m001", "m002", "m003"] })
    expect(h.calls().map(callOf)).toEqual(["m001", "m002", "m003"].map((id) => `POST ${messageActionUrl(id, "trash")}`))
  })

  test("threads are trashed one request each", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.trash.run({ threads: ["t001", "t002"] })).toEqual({ trashed: 2, ids: ["t001", "t002"] })
    expect(h.calls().map(callOf)).toEqual(["t001", "t002"].map((id) => `POST ${threadActionUrl(id, "trash")}`))
  })

  test("a repeated id is trashed once", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.trash.run({ messages: ["m001", "m001"] })).toEqual({ trashed: 1, ids: ["m001"] })
    expect(h.calls()).toHaveLength(1)
  })

  test("a failure after earlier ones were trashed is listed under errors, and the ids after it are not tried", async () => {
    const h = await mailboxFixture({ handlers: [refuse("m003", 404, { status: "NOT_FOUND" }), ...handlers] })
    const result = await h.trash.run({ messages: idsOf("m", 5) })
    expect(result).toEqual({
      trashed: 2,
      ids: ["m001", "m002"],
      errors: { m003: expect.stringMatching(/^not_found: /) },
    })
    expect(h.calls().map(callOf)).toEqual(idsOf("m", 3).map((id) => `POST ${messageActionUrl(id, "trash")}`))
  })

  test("a failure of the first one throws, since nothing was trashed", async () => {
    const h = await mailboxFixture({ handlers: [refuse("m001", 403, { status: "PERMISSION_DENIED" }), ...handlers] })
    expect((await toolError(h.trash.run({ messages: ["m001", "m002"] }))).code).toBe("forbidden")
    expect(h.calls()).toHaveLength(1)
  })

  test("a failure of the last thread is listed, with the threads trashed before it", async () => {
    const h = await mailboxFixture({ handlers: [refuse("t002", 429, { status: "RESOURCE_EXHAUSTED" }), ...handlers] })
    expect(await h.trash.run({ threads: ["t001", "t002"] })).toMatchObject({
      trashed: 1,
      ids: ["t001"],
      errors: { t002: expect.stringMatching(/^rate_limited: /) },
    })
  })
})

describe("google_gmail_trash arguments, scopes, targets and bounds", () => {
  test.each([
    ["neither messages nor threads", {}],
    ["both", { messages: ["m1"], threads: ["t1"] }],
    ["an empty list", { messages: [] }],
    ["101 messages", { messages: idsOf("m", 101) }],
    ["101 threads", { threads: idsOf("t", 101) }],
    ["an id that is not an id", { messages: ["a/b"] }],
    ["an unknown argument", { messages: ["m1"], permanent: true }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await mailboxFixture({ handlers })
    expect((await toolError(h.trash.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("100 messages are accepted", async () => {
    const h = await mailboxFixture({ handlers })
    expect((await h.trash.run({ messages: idsOf("m", 100) })).trashed).toBe(100)
  })

  test("a label without gmail.modify fails before any request, for messages and threads", async () => {
    const h = await mailboxFixture({ handlers, credential: GMAIL_CREDENTIAL })
    for (const args of [{ messages: ["m001"] }, { threads: ["t001"] }]) {
      const error = await toolError(h.trash.run(args))
      expect(error.code).toBe("unauthenticated")
      expect(error.message).toContain("gmail.modify")
    }
    expect(h.calls()).toEqual([])
  })

  test("one target per message or thread, `<label>/messages/<id>` or `<label>/threads/<id>`", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.trash.targets({ messages: ["m002", "m001"] })).toEqual(["work/messages/m001", "work/messages/m002"])
    expect(await h.trash.targets({ threads: ["t001"] })).toEqual(["work/threads/t001"])
    expect(await h.trash.targets({ messages: ["a?b"] })).toEqual(["*"])
    expect(await h.trash.targets({})).toEqual(["*"])
  })

  test("the items bound is the number of messages or threads", async () => {
    const h = await mailboxFixture()
    expect(await h.trash.measure({ messages: ["a", "b"] })).toEqual({ items: 2 })
    expect(await h.trash.measure({ threads: ["a"] })).toEqual({ items: 1 })
  })
})
