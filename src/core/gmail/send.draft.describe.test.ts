import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  DRAFT_CREDENTIAL,
  DRAFT_HEADERS,
  DRAFT_ID,
  DRAFT_MESSAGE_ID,
  cleanUp,
  draftFull,
  draftHandler,
  draftSendHandler,
  freshTokens,
  removeUploads,
} from "./draft.testing"
import { answer, encoded, filePart, headersOf } from "./read.testing"
import { googleGmailSend } from "./send"
import { sendFixture } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const args = { draft_id: DRAFT_ID }

const factsOf = (description: { facts: { label: string; value: unknown }[] }) =>
  Object.fromEntries(description.facts.map(({ label, value }) => [label, value]))

/** A fixture whose label may compose and whose mailbox holds `reply` as the draft. */
const holding = (reply: unknown, credential = DRAFT_CREDENTIAL) =>
  sendFixture({ handlers: [draftHandler(reply), draftSendHandler], credential })

describe("google_gmail_send describe of a draft", () => {
  test("headlines the draft's subject and first recipient, as a composed send does", async () => {
    const h = await holding(draftFull())
    expect((await h.describe(args)).headline).toEqual({
      text: "About to send {subject} to {recipient}",
      values: { subject: "Lunch plans", recipient: "ann@example.test" },
    })
    await cleanUp()
    const many = await holding(
      draftFull({ ...DRAFT_HEADERS, To: "Ann <ann@example.test>, bob@example.test", Cc: "cy@example.test" }),
    )
    expect((await many.describe(args)).headline).toEqual({
      text: "About to send {subject} to {recipient} and {count} more",
      values: { subject: "Lunch plans", recipient: "ann@example.test", count: "2" },
    })
  })

  test("shows the draft's address lines, subject and text body in the Message, with display names left out", async () => {
    const headers = {
      To: '"Ann Lee" <ann@example.test>',
      Cc: "Bo <bo@other.test>",
      Bcc: "dee@example.test",
      Subject: "Lunch\r\n plans",
    }
    const h = await holding(draftFull(headers, "Are we still on?"))
    expect((await h.describe(args)).text).toEqual({
      label: "Message",
      body: "To: ann@example.test\nCc: bo@other.test\nBcc: dee@example.test\nSubject: Lunch plans\n\nAre we still on?",
    })
  })

  test("shows Outside, Copies and Size in order, the size being Google's estimate of the draft, and pins the draft", async () => {
    const h = await holding(draftFull({ ...DRAFT_HEADERS, Cc: "bo@other.test" }, "Hi", [], { sizeEstimate: 2048 }))
    const description = await h.describe(args)
    expect(description.facts.map((fact) => fact.label)).toEqual(["Outside", "Copies", "Size"])
    expect(factsOf(description)).toMatchObject({
      Outside: { text: "yes: {domains}", values: { domains: "other.test" } },
      Copies: { text: "{cc} cc, {bcc} bcc", values: { cc: 1, bcc: 0 } },
      Size: { text: "{bytes} bytes", values: { bytes: 2048 } },
    })
    expect(description.pins).toEqual({ draft: DRAFT_MESSAGE_ID })
  })

  test("leaves the Size out when Google gives no estimate", async () => {
    const h = await holding(draftFull(DRAFT_HEADERS, "Hi", [], {}))
    expect((await h.describe(args)).facts.map((fact) => fact.label)).toEqual(["Outside"])
  })

  test("lists the draft's attachments with their names and sizes from its parts", async () => {
    const parts = [
      filePart("1", "report.pdf", { size: 2048, attachmentId: "a-1" }),
      filePart("2", "ノート.txt", { size: 6, data: encoded("メモ") }, "text/plain"),
    ]
    const h = await holding(draftFull(DRAFT_HEADERS, "Hi", parts))
    const description = await h.describe(args)
    expect(description.facts.map((fact) => fact.label)).toEqual(["Outside", "Attachments", "Size"])
    expect(factsOf(description).Attachments).toBe("report.pdf (2.0 KiB), ノート.txt (6 B)")
  })

  test("the text body is cut at 20,000 characters like a read's, and an HTML-only draft shows its text", async () => {
    const long = await holding(draftFull(DRAFT_HEADERS, "x".repeat(20_001)))
    expect((await long.describe(args)).text?.body).toEndWith(`\n\n${"x".repeat(20_000)}`)
    await cleanUp()
    const html = {
      ...draftFull(),
      message: {
        ...draftFull().message,
        payload: {
          mimeType: "text/html",
          headers: headersOf(DRAFT_HEADERS),
          body: { size: 20, data: encoded("<p>Hello <b>Ann</b></p>") },
        },
      },
    }
    expect((await (await holding(html)).describe(args)).text?.body).toEndWith("\n\nHello Ann")
  })

  test("pins the draft's message id: a draft edited after the prompt describes differently", async () => {
    const edited = draftFull()
    edited.message.id = "18f3a2b4c5d6e9aa"
    const before = (await (await holding(draftFull())).describe(args)).pins
    await cleanUp()
    const after = (await (await holding(edited)).describe(args)).pins
    expect([before, after]).toEqual([{ draft: DRAFT_MESSAGE_ID }, { draft: "18f3a2b4c5d6e9aa" }])
  })

  test("describe throws where execute would refuse: a draft with no recipient", async () => {
    const h = await holding(draftFull({ Subject: "Notes" }))
    await expect(h.describe(args)).rejects.toMatchObject({ code: "invalid_argument" })
  })
})

describe("google_gmail_send measure of a draft", () => {
  const measure = async (reply: unknown, credential = DRAFT_CREDENTIAL) => {
    const h = await holding(reply, credential)
    return googleGmailSend.measure!(googleGmailSend.input.parse(args), h.ctx)
  }

  test("counts the recipients the draft's headers list, to, cc and bcc together", async () => {
    const headers = { To: "Ann <ann@example.test>, bob@example.test", Cc: "cy@example.test", Bcc: "dee@example.test" }
    expect(await measure(draftFull(headers))).toEqual({ recipients: 4, outside_domain: false, attachments: false })
  })

  test("outside_domain is true when a recipient of the draft is outside the account's domain, or the account's address is unknown", async () => {
    expect((await measure(draftFull({ ...DRAFT_HEADERS, Bcc: "eve@other.test" }))).outside_domain).toBe(true)
    expect((await measure(draftFull(), { ...DRAFT_CREDENTIAL, email: null })).outside_domain).toBe(true)
  })

  test("attachments is true when the draft has any", async () => {
    const parts = [filePart("1", "report.pdf", { size: 1, attachmentId: "a-1" })]
    expect((await measure(draftFull(DRAFT_HEADERS, "Hi", parts))).attachments).toBe(true)
  })

  test("a draft that cannot be read fails the measure, which a grant takes as covering nothing", async () => {
    const h = await sendFixture({
      handlers: [answer("https://gmail.googleapis.com/x", {})],
      credential: DRAFT_CREDENTIAL,
    })
    await expect(googleGmailSend.measure!(googleGmailSend.input.parse(args), h.ctx)).rejects.toThrow()
  })

  test("mail arguments with draft_id fail the measure too", async () => {
    const h = await holding(draftFull())
    const parsed = googleGmailSend.input.parse({ ...args, to: ["ann@example.test"] })
    await expect(googleGmailSend.measure!(parsed, h.ctx)).rejects.toMatchObject({ code: "invalid_argument" })
  })
})
