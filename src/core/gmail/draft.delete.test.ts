import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import { annotations } from "../tool"
import {
  DRAFT_HEADERS,
  DRAFT_ID,
  DRAFT_MESSAGE_ID,
  callOf,
  cleanUp,
  deleteHandler,
  draftHandler,
  draftMetadata,
  draftUrl,
  freshTokens,
} from "./draft.testing"
import { draftFixture } from "./draft.fixture.testing"
import { googleGmailDraftDelete } from "./draft-delete"

beforeEach(freshTokens)
afterEach(cleanUp)

const args = { draft_id: DRAFT_ID }
const current = draftHandler(draftMetadata())

describe("google_gmail_draft_delete class and words", () => {
  test("administrative: Gmail deletes a draft permanently, so it is destructive and not repeatable", () => {
    expect(googleGmailDraftDelete).toMatchObject({
      id: "google_gmail_draft_delete",
      toolset: "gmail",
      class: "administrative",
    })
    expect(annotations(googleGmailDraftDelete)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    })
  })

  test("says that the deletion is permanent, that it takes one draft and what it returns", () => {
    const { description } = googleGmailDraftDelete
    expect(description).toContain("permanently")
    expect(description).toContain("cannot be undone")
    expect(description).toContain("One draft per call")
    expect(description).toContain("`deleted: true`")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleGmailDraftDelete.title]).toBeDefined()
    expect(ja[googleGmailDraftDelete.intent!]).toBeDefined()
    expect(ja["About to delete the draft {subject}"]).toBe("下書き {subject} を削除しようとしています")
    expect(ja["About to delete a draft with no subject"]).toBeDefined()
    expect(ja.To).toBe("宛先")
    expect(ja.Date).toBe("日付")
  })
})

describe("google_gmail_draft_delete describe", () => {
  test("headlines the draft's subject and shows its recipients and date as Google reports them, pinning its message id", async () => {
    const h = await draftFixture({ handlers: [current] })
    const description = await h.delete.describe(args)
    expect(description.headline).toEqual({
      text: "About to delete the draft {subject}",
      values: { subject: "Lunch plans" },
    })
    expect(description.facts).toEqual([
      { label: "To", value: "Ann <ann@example.test>" },
      { label: "Date", value: "Mon, 1 Jun 2026 09:00:00 +0000" },
    ])
    expect(description.text).toBeUndefined()
    expect(description.pins).toEqual({ draft: DRAFT_MESSAGE_ID })
    const [read] = h.calls()
    expect(callOf(read!)).toBe(`GET ${draftUrl(DRAFT_ID)}`)
    expect(read!.url.searchParams.get("format")).toBe("metadata")
  })

  test("a draft with no subject has its own headline, and one with no recipient or date shows no such fact", async () => {
    const h = await draftFixture({ handlers: [draftHandler(draftMetadata({ Subject: "" }))] })
    const description = await h.delete.describe(args)
    expect(description.headline).toEqual({ text: "About to delete a draft with no subject" })
    expect(description.facts).toEqual([])
  })

  test("the pin changes when the draft is edited, since its message id does", async () => {
    const edited = await draftFixture({ handlers: [draftHandler(draftMetadata(DRAFT_HEADERS, "18f3a2b4c5d6e9aa"))] })
    expect((await edited.delete.describe(args)).pins).toEqual({ draft: "18f3a2b4c5d6e9aa" })
  })

  test("describe throws where execute would: a draft that is not found, an id that is not an id", async () => {
    const h = await draftFixture({
      handlers: [{ method: "GET", url: draftUrl(DRAFT_ID), reply: { status: 404, json: { error: {} } } }],
    })
    expect((await toolError(h.delete.describe(args))).code).toBe("not_found")
    expect((await toolError(h.delete.describe({ draft_id: "a/b" }))).code).toBe("invalid_argument")
  })
})

describe("google_gmail_draft_delete request and targets", () => {
  test("reads the draft, then deletes it, and returns its id", async () => {
    const h = await draftFixture({ handlers: [current, deleteHandler] })
    expect(await h.delete.run(args)).toEqual({ draft_id: DRAFT_ID, deleted: true })
    expect(h.draftCalls().map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      `GET /gmail/v1/users/me/drafts/${DRAFT_ID}`,
      `DELETE /gmail/v1/users/me/drafts/${DRAFT_ID}`,
    ])
  })

  test("a draft that is already gone is not_found, and no delete is sent", async () => {
    const h = await draftFixture({
      handlers: [
        { method: "GET", url: draftUrl(DRAFT_ID), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
        deleteHandler,
      ],
    })
    expect((await toolError(h.delete.run(args))).code).toBe("not_found")
    expect(h.draftCalls().map((request) => request.method)).toEqual(["GET"])
  })

  test("takes one draft: a missing id, a bad id and a list of ids are refused before any request", async () => {
    const h = await draftFixture({ handlers: [current, deleteHandler] })
    for (const bad of [{}, { draft_id: "../x" }, { draft_id: ["r-1", "r-2"] }, { ...args, extra: 1 }]) {
      expect((await toolError(h.delete.run(bad))).code).toBe("invalid_argument")
    }
    expect(h.calls()).toEqual([])
  })

  test("its one target is the draft, `<label>/drafts/<draft_id>`, and `*` when it cannot be told", async () => {
    const h = await draftFixture()
    expect(await h.delete.targets(args)).toEqual([`work/drafts/${DRAFT_ID}`])
    expect(await h.delete.targets({ draft_id: "r-?" })).toEqual(["*"])
    expect(await (await draftFixture({ credential: null })).delete.targets(args)).toEqual(["*"])
  })

  test("declares no bounds: there is nothing in the call to limit beyond its target", () => {
    expect(googleGmailDraftDelete.bounds).toBeUndefined()
    expect(googleGmailDraftDelete.measure).toBeUndefined()
  })
})
