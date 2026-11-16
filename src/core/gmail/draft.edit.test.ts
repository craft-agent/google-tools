import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import { annotations } from "../tool"
import {
  DRAFT_HEADERS,
  DRAFT_ID,
  DRAFT_MESSAGE_ID,
  UPLOAD_DRAFTS_URL,
  WRITTEN,
  callOf,
  cleanUp,
  draftHandler,
  draftMetadata,
  draftUrl,
  freshTokens,
  removeUploads,
  updateHandler,
} from "./draft.testing"
import { draftFixture } from "./draft.fixture.testing"
import { googleGmailDraftEdit } from "./draft-edit"
import { MESSAGE_ID, THREAD_ID } from "./read.testing"
import { ORIGINAL_ID, originalHandler, sentMail } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const current = draftHandler(draftMetadata())
const edit = { draft_id: DRAFT_ID, to: ["ann@example.test"], subject: "Lunch at noon", body: "Noon, then?" }

const factsOf = (description: { facts: { label: string; value: unknown }[] }) =>
  Object.fromEntries(description.facts.map(({ label, value }) => [label, value]))

describe("google_gmail_draft_edit class and words", () => {
  test("overwrite: it replaces the draft's whole message, so it is destructive but repeatable", () => {
    expect(googleGmailDraftEdit).toMatchObject({ id: "google_gmail_draft_edit", toolset: "gmail", class: "overwrite" })
    expect(annotations(googleGmailDraftEdit)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    })
  })

  test("says that the arguments are the whole new message and nothing of the old one is kept", () => {
    expect(googleGmailDraftEdit.description).toContain("nothing is kept from the old one")
    expect(googleGmailDraftEdit.description).toContain("`message_id` changes")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleGmailDraftEdit.title]).toBeDefined()
    expect(ja[googleGmailDraftEdit.intent!]).toBeDefined()
    expect(ja["About to replace a draft with {subject}"]).toContain("{subject}")
    expect(ja["{subject} (recipients: {count})"]).toBe("{subject}（宛先 {count} 件）")
    expect(ja.Replaces).toBeDefined()
  })
})

describe("google_gmail_draft_edit request", () => {
  test("reads the draft's headers, then puts the new mail on the draft's upload route with its id in the JSON part", async () => {
    const h = await draftFixture({ handlers: [current, updateHandler] })
    const result = await h.edit.run(edit)
    const [read, put] = h.draftCalls()
    expect(callOf(read!)).toBe(`GET ${draftUrl(DRAFT_ID)}`)
    expect(read!.url.searchParams.get("format")).toBe("metadata")
    expect(callOf(put!)).toBe(`PUT ${UPLOAD_DRAFTS_URL}/${DRAFT_ID}`)
    expect(put!.url.searchParams.get("uploadType")).toBe("multipart")
    const { metadata, mail } = sentMail(put!)
    expect(metadata).toEqual({ id: DRAFT_ID, message: {} })
    expect(mail.headers).toMatchObject({ to: "ann@example.test", subject: "Lunch at noon" })
    expect(mail.content?.toString()).toBe("Noon, then?")
    expect(result).toEqual({ draft_id: DRAFT_ID, message_id: WRITTEN.message.id, thread_id: THREAD_ID })
  })

  test("the new message is the whole message: nothing of the old headers is carried over", async () => {
    const old = { ...DRAFT_HEADERS, Cc: "bo@example.test", Bcc: "dee@example.test" }
    const h = await draftFixture({ handlers: [draftHandler(draftMetadata(old)), updateHandler] })
    await h.edit.run(edit)
    const { mail } = sentMail(h.draftCalls()[1]!)
    expect(mail.headers.cc).toBeUndefined()
    expect(mail.headers.bcc).toBeUndefined()
  })

  test("a reply puts its original's thread in the JSON part", async () => {
    const h = await draftFixture({ handlers: [current, originalHandler(), updateHandler] })
    await h.edit.run({ draft_id: DRAFT_ID, to: edit.to, reply_to: MESSAGE_ID, body: "Yes." })
    const { metadata, mail } = sentMail(h.draftCalls().find((request) => request.method === "PUT")!)
    expect(metadata).toEqual({ id: DRAFT_ID, message: { threadId: THREAD_ID } })
    expect(mail.headers["in-reply-to"]).toBe(ORIGINAL_ID)
  })

  test("a draft that is not found is not_found, and nothing is put", async () => {
    const h = await draftFixture({
      handlers: [
        { method: "GET", url: draftUrl(DRAFT_ID), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
        updateHandler,
      ],
    })
    expect((await toolError(h.edit.run(edit))).code).toBe("not_found")
    expect(h.draftCalls().map((request) => request.method)).toEqual(["GET"])
  })

  test("a draft id that is not an id, a missing draft_id and a missing body are refused before any request", async () => {
    const h = await draftFixture({ handlers: [current, updateHandler] })
    for (const args of [
      { ...edit, draft_id: "../x" },
      { ...edit, draft_id: undefined },
      { ...edit, body: undefined },
    ]) {
      expect((await toolError(h.edit.run(args))).code).toBe("invalid_argument")
    }
    expect(h.calls()).toEqual([])
  })
})

describe("google_gmail_draft_edit describe", () => {
  test("shows the draft it replaces first, as Google holds it: its subject and how many recipients", async () => {
    const headers = { ...DRAFT_HEADERS, To: 'Ann <ann@example.test>, "Bo, B" <bo@example.test>', Cc: "cy@example.test" }
    const h = await draftFixture({ handlers: [draftHandler(draftMetadata(headers))] })
    const description = await h.edit.describe(edit)
    expect(description.headline).toEqual({
      text: "About to replace a draft with {subject}",
      values: { subject: "Lunch at noon" },
    })
    expect(description.facts.map((fact) => fact.label)).toEqual(["Replaces", "Outside", "Size"])
    expect(factsOf(description).Replaces).toEqual({
      text: "{subject} (recipients: {count})",
      values: { subject: "Lunch plans", count: 3 },
    })
    expect(description.text).toMatchObject({
      label: "Message",
      body: "To: ann@example.test\nSubject: Lunch at noon\n\nNoon, then?",
    })
  })

  test("a draft with no subject and no recipient says so in its own template", async () => {
    const h = await draftFixture({ handlers: [draftHandler(draftMetadata({}))] })
    expect(factsOf(await h.edit.describe(edit)).Replaces).toEqual({
      text: "(no subject) (recipients: {count})",
      values: { count: 0 },
    })
  })

  test("pins the draft's message id, which a later edit of the draft changes", async () => {
    const before = await draftFixture({ handlers: [current] })
    expect((await before.edit.describe(edit)).pins).toEqual({ draft: DRAFT_MESSAGE_ID })
    await cleanUp()
    const after = await draftFixture({ handlers: [draftHandler(draftMetadata(DRAFT_HEADERS, "18f3a2b4c5d6e9aa"))] })
    expect((await after.edit.describe(edit)).pins).toEqual({ draft: "18f3a2b4c5d6e9aa" })
  })

  test("the draft's pin stands beside the attachments' and the original's", async () => {
    const h = await draftFixture({ handlers: [current, originalHandler()], files: { "a.txt": "x" } })
    const description = await h.edit.describe({
      draft_id: DRAFT_ID,
      to: edit.to,
      reply_to: MESSAGE_ID,
      body: "Yes.",
      attachments: [join(h.uploadDir, "a.txt")],
    })
    expect(Object.keys(description.pins!).sort()).toEqual(["attachments", "draft", "message_id"])
    expect(description.facts.map((fact) => fact.label)).toEqual([
      "Replaces",
      "Outside",
      "Reply to",
      "Attachments",
      "Size",
    ])
  })
})

describe("google_gmail_draft_edit targets and measure", () => {
  test("its one target is the draft, `<label>/drafts/<draft_id>`", async () => {
    const h = await draftFixture()
    expect(await h.edit.targets(edit)).toEqual([`work/drafts/${DRAFT_ID}`])
  })

  test("is `*` for an id that is not one, a missing label or wrong arguments", async () => {
    const h = await draftFixture()
    expect(await h.edit.targets({ ...edit, draft_id: "r-*" })).toEqual(["*"])
    expect(await h.edit.targets({ ...edit, body: "" })).toEqual(["*"])
    expect(await (await draftFixture({ credential: null })).edit.targets(edit)).toEqual(["*"])
  })

  test("measures whether the new message carries attachments, from the arguments alone", async () => {
    const h = await draftFixture()
    expect(await h.edit.measure(edit)).toEqual({ attachments: false })
    expect(await h.edit.measure({ ...edit, attachments: ["/x/y"] })).toEqual({ attachments: true })
  })
})
