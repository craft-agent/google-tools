import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { googleSession } from "../google/session"
import { applyLabelChange } from "./label-apply"
import type { LabelPlan } from "./label-plan"
import { GMAIL_CREDENTIAL } from "./read.testing"
import {
  BATCH_MODIFY_URL,
  callOf,
  cleanUp,
  freshTokens,
  idsOf,
  labelsHandler,
  mailboxFixture,
  messageActionUrl,
  postHandler,
  threadActionUrl,
} from "./mailbox.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const handlers = [
  labelsHandler(),
  postHandler(BATCH_MODIFY_URL),
  postHandler(/\/messages\/[^/]+\/untrash$/),
  postHandler(/\/threads\/[^/]+\/(modify|untrash)$/),
]

describe("google_gmail_label requests", () => {
  test("messages go in one batchModify with the ids and the label ids, and the result counts them", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.label.run({ messages: ["m001", "m002"], add_labels: ["Receipts"], remove_labels: ["INBOX"] })
    expect(result).toEqual({ changed: 2, adds: ["Receipts"], removes: ["INBOX"], untrashed: 0 })
    expect(h.writes().map(callOf)).toEqual([`POST ${BATCH_MODIFY_URL}`])
    expect(h.writes()[0]!.json).toEqual({ ids: ["m001", "m002"], addLabelIds: ["Label_1"], removeLabelIds: ["INBOX"] })
  })

  test("duplicate ids are changed once", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.label.run({ messages: ["m001", "m001"], remove_labels: ["UNREAD"] })
    expect(result.changed).toBe(1)
    expect((h.writes()[0]!.json as { ids: string[] }).ids).toEqual(["m001"])
  })

  test("a batch holds at most 1000 ids: 2500 ids go in three requests, in order", async () => {
    const h = await mailboxFixture({ handlers })
    const ids = idsOf("m", 2500)
    const { client: google } = await googleSession(h.ctx, undefined, "test")
    const plan: LabelPlan = {
      client: google,
      label: "work",
      selection: { kind: "messages", ids },
      adds: [],
      removes: [{ id: "INBOX", name: "INBOX" }],
      untrash: false,
    }
    expect(await applyLabelChange(plan)).toMatchObject({ changed: 2500 })
    const batches = h.writes().map((request) => (request.json as { ids: string[] }).ids)
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 500])
    expect(batches.flat()).toEqual(ids)
  })

  test("threads are modified one request each, with the label ids", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.label.run({ threads: ["t001", "t002", "t003"], add_labels: ["STARRED"] })
    expect(result).toEqual({ changed: 3, adds: ["STARRED"], removes: [], untrashed: 0 })
    expect(h.writes().map(callOf).sort()).toEqual(
      ["t001", "t002", "t003"].map((id) => `POST ${threadActionUrl(id, "modify")}`),
    )
    for (const request of h.writes()) expect(request.json).toEqual({ addLabelIds: ["STARRED"], removeLabelIds: [] })
  })

  test("untrash moves each message out of the trash before the labels change", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.label.run({ messages: ["m001", "m002"], remove_labels: ["INBOX"], untrash: true })
    expect(result).toMatchObject({ changed: 2, untrashed: 2 })
    const calls = h.writes().map(callOf)
    expect(calls.slice(0, 2).sort()).toEqual([
      `POST ${messageActionUrl("m001", "untrash")}`,
      `POST ${messageActionUrl("m002", "untrash")}`,
    ])
    expect(calls.slice(2)).toEqual([`POST ${BATCH_MODIFY_URL}`])
  })

  test("untrash moves each thread out of the trash before it is modified", async () => {
    const h = await mailboxFixture({ handlers })
    await h.label.run({ threads: ["t001"], add_labels: ["Receipts"], untrash: true })
    expect(h.writes().map(callOf)).toEqual([
      `POST ${threadActionUrl("t001", "untrash")}`,
      `POST ${threadActionUrl("t001", "modify")}`,
    ])
  })

  test("untrash alone changes no label and reads no label list", async () => {
    const h = await mailboxFixture({ handlers })
    const result = await h.label.run({ messages: ["m001"], untrash: true })
    expect(result).toEqual({ changed: 1, adds: [], removes: [], untrashed: 1 })
    expect(h.calls().map(callOf)).toEqual([`POST ${messageActionUrl("m001", "untrash")}`])
  })

  test("a failure of the untrash stops the call before any label changes", async () => {
    const h = await mailboxFixture({
      handlers: [
        labelsHandler(),
        postHandler(BATCH_MODIFY_URL),
        { method: "POST", url: /untrash$/, reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
      ],
    })
    expect((await toolError(h.label.run({ messages: ["m001"], remove_labels: ["INBOX"], untrash: true }))).code).toBe(
      "not_found",
    )
    expect(h.writes().map(callOf)).toEqual([`POST ${messageActionUrl("m001", "untrash")}`])
  })
})

describe("google_gmail_label arguments", () => {
  test.each([
    ["neither messages nor threads", { add_labels: ["INBOX"] }],
    ["both messages and threads", { messages: ["m1"], threads: ["t1"], add_labels: ["INBOX"] }],
    ["nothing to change", { messages: ["m1"] }],
    ["an empty id list", { messages: [], add_labels: ["INBOX"] }],
    ["too many threads", { threads: Array.from({ length: 101 }, (_, i) => `t${i}`), add_labels: ["INBOX"] }],
    ["too many messages", { messages: Array.from({ length: 1001 }, (_, i) => `m${i}`), add_labels: ["INBOX"] }],
    ["too many labels", { messages: ["m1"], add_labels: Array.from({ length: 21 }, (_, i) => `L${i}`) }],
    ["an empty label list", { messages: ["m1"], add_labels: [] }],
    ["untrash false", { messages: ["m1"], untrash: false }],
    ["an id that is not an id", { messages: ["a/b"], add_labels: ["INBOX"] }],
    ["an unknown argument", { messages: ["m1"], add_labels: ["INBOX"], extra: 1 }],
  ])("%s is refused before any request", async (_name, args) => {
    const h = await mailboxFixture({ handlers })
    expect((await toolError(h.label.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("a label without gmail.modify fails before any request, as unauthenticated naming the scope", async () => {
    const h = await mailboxFixture({ handlers, credential: GMAIL_CREDENTIAL })
    const error = await toolError(h.label.run({ messages: ["m001"], add_labels: ["INBOX"] }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("gmail.modify")
    expect(h.calls()).toEqual([])
    const threads = await toolError(h.label.run({ threads: ["t001"], add_labels: ["INBOX"] }))
    expect(threads.code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })
})

describe("google_gmail_label targets and bounds", () => {
  test("one target per label added or removed, by id, sorted and each once, and `<label>/trash` for untrash", async () => {
    const h = await mailboxFixture({ handlers })
    expect(
      await h.label.targets({ messages: ["m001"], add_labels: ["Receipts", "STARRED"], remove_labels: ["INBOX"] }),
    ).toEqual(["work/labels/INBOX", "work/labels/Label_1", "work/labels/STARRED"])
    expect(await h.label.targets({ threads: ["t001"], untrash: true })).toEqual(["work/trash"])
    expect(await h.label.targets({ threads: ["t001"], remove_labels: ["INBOX"], untrash: true })).toEqual([
      "work/labels/INBOX",
      "work/trash",
    ])
  })

  test("the targets are `*` where they cannot be told: an unknown label, a label that may not be changed", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.label.targets({ messages: ["m001"], add_labels: ["Nope"] })).toEqual(["*"])
    expect(await h.label.targets({ messages: ["m001"], add_labels: ["TRASH"] })).toEqual(["*"])
  })

  test("the items bound is the number of messages or threads the call names", async () => {
    const h = await mailboxFixture()
    expect(await h.label.measure({ messages: ["a", "b", "c"], add_labels: ["INBOX"] })).toEqual({ items: 3 })
    expect(await h.label.measure({ threads: ["a"], add_labels: ["INBOX"] })).toEqual({ items: 1 })
  })
})
