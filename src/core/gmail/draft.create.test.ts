import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { UPLOAD_DRAFTS_URL, WRITTEN, callOf, cleanUp, createHandler, freshTokens, removeUploads } from "./draft.testing"
import { draftFixture } from "./draft.fixture.testing"
import { MESSAGE_ID, THREAD_ID } from "./read.testing"
import { originalHandler, sentMail } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const base = { to: ["ann@example.test"], subject: "Lunch", body: "Are we still on?" }

const addresses = (count: number) => Array.from({ length: count }, (_, index) => `person${index}@example.test`)

describe("google_gmail_draft_create request", () => {
  test("posts the JSON part, then the mail as message/rfc822, on the draft upload route", async () => {
    const h = await draftFixture({ handlers: [createHandler] })
    await h.create.run(base)
    const [request] = h.draftCalls()
    expect(callOf(request!)).toBe(`POST ${UPLOAD_DRAFTS_URL}`)
    expect(request!.url.searchParams.get("uploadType")).toBe("multipart")
    const { type, metadata, mail } = sentMail(request!)
    expect(type).toStartWith("multipart/related; boundary=")
    expect(metadata).toEqual({ message: {} })
    expect(mail.headers).toMatchObject({ to: "ann@example.test", subject: "Lunch", "mime-version": "1.0" })
    expect(mail.content?.toString()).toBe("Are we still on?")
  })

  test("returns the draft's id, its message's id and its thread, empty where Google reports none", async () => {
    const h = await draftFixture({ handlers: [createHandler] })
    expect(await h.create.run(base)).toEqual({
      draft_id: WRITTEN.id,
      message_id: WRITTEN.message.id,
      thread_id: THREAD_ID,
    })
    await cleanUp()
    const bare = await draftFixture({ handlers: [{ ...createHandler, reply: { json: {} } }] })
    expect(await bare.create.run(base)).toEqual({ draft_id: "", message_id: "", thread_id: "" })
  })

  test("a draft may have no recipient: it has no To header and is made all the same", async () => {
    const h = await draftFixture({ handlers: [createHandler] })
    await h.create.run({ subject: "Later", body: "Notes" })
    await h.create.run({ ...base, to: [] })
    const [first, second] = h.draftCalls().map((request) => sentMail(request).mail.headers)
    expect(first!.to).toBeUndefined()
    expect(second!.to).toBeUndefined()
  })

  test("carries to, cc and bcc, an html body beside its text, and attachments from the upload directory", async () => {
    const h = await draftFixture({ handlers: [createHandler], files: { "report.pdf": "%PDF-1" } })
    await h.create.run({
      ...base,
      cc: ["bob@example.test"],
      bcc: ["dee@example.test"],
      body: "<p>Hi</p>",
      html: true,
      attachments: [join(h.uploadDir, "report.pdf")],
    })
    const { mail } = sentMail(h.draftCalls()[0]!)
    expect(mail.headers).toMatchObject({ cc: "bob@example.test", bcc: "dee@example.test" })
    expect(mail.type).toBe("multipart/mixed")
    const [content, pdf] = mail.parts!
    expect(content!.parts!.map((part) => part.type)).toEqual(["text/plain", "text/html"])
    expect([pdf!.type, pdf!.content?.toString()]).toEqual(["application/pdf", "%PDF-1"])
  })

  test("a reply joins its original's thread, in the JSON part, with In-Reply-To and References", async () => {
    const h = await draftFixture({ handlers: [originalHandler(), createHandler] })
    await h.create.run({ to: base.to, reply_to: MESSAGE_ID, body: "Yes." })
    const [read] = h.calls()
    expect(read!.url.pathname).toBe(`/gmail/v1/users/me/messages/${MESSAGE_ID}`)
    const { metadata, mail } = sentMail(h.draftCalls()[0]!)
    expect(metadata).toEqual({ message: { threadId: THREAD_ID } })
    expect(mail.headers).toMatchObject({
      "in-reply-to": "<original-1@example.test>",
      references: "<root@example.test> <original-1@example.test>",
      subject: "Re: Lunch",
    })
  })

  test("a Google failure is an error that holds none of the mail's text", async () => {
    const h = await draftFixture({
      handlers: [
        {
          ...createHandler,
          reply: { status: 400, json: { error: { message: "Bad draft", status: "INVALID_ARGUMENT" } } },
        },
      ],
    })
    const error = await toolError(h.create.run(base))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Bad draft")
    expect(error.message).not.toContain("Are we still on")
  })
})

describe("google_gmail_draft_create arguments", () => {
  test("takes 0 to 100 addresses in to and refuses 101, with the limits and rules of a send, before any request", async () => {
    const h = await draftFixture({ handlers: [createHandler] })
    await h.create.run({ ...base, to: addresses(100) })
    expect(h.draftCalls().length).toBe(1)
    const refused = [
      { ...base, to: addresses(101) },
      { ...base, to: ["Ann <ann@example.test>"] },
      { ...base, to: ["ann@example.test", "ANN@example.test"] },
      { ...base, to: [], cc: ["bob@example.test"], bcc: ["Bob@example.test"] },
      { ...base, body: "" },
      { to: base.to, body: "x" },
      { ...base, attachments: [] },
    ]
    for (const args of refused) expect((await toolError(h.create.run(args))).code).toBe("invalid_argument")
    expect(h.draftCalls().length).toBe(1)
  })

  test("a mail with a line break in its subject is refused, and so is an unknown argument such as draft_id", async () => {
    const h = await draftFixture({ handlers: [createHandler] })
    expect((await toolError(h.create.run({ ...base, subject: "A\nBcc: eve@example.test" }))).code).toBe(
      "invalid_argument",
    )
    expect((await toolError(h.create.run({ ...base, draft_id: "r-1" }))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("attachments are read only from the upload directories, as a send reads them", async () => {
    const h = await draftFixture({ handlers: [createHandler], files: { "a.txt": "x" } })
    expect((await toolError(h.create.run({ ...base, attachments: [join(h.uploadDir, "..", "a.txt")] }))).code).toBe(
      "forbidden",
    )
    expect(h.calls()).toEqual([])
  })
})
