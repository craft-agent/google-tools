import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  DRAFT_CREDENTIAL,
  DRAFT_HEADERS,
  DRAFT_ID,
  DRAFT_SEND_URL,
  cleanUp,
  draftFull,
  draftHandler,
  draftSendHandler,
  draftUrl,
  freshTokens,
  removeUploads,
} from "./draft.testing"
import { THREAD_ID } from "./read.testing"
import { GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE } from "./scopes"
import { SEND_CREDENTIAL, callOf, sendFixture } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

/** A fixture whose label may compose, holding the draft with `headers` and taking its send. */
const sending = (headers: Record<string, string> = DRAFT_HEADERS, text?: string) =>
  sendFixture({
    handlers: [draftHandler(draftFull(headers, text)), draftSendHandler],
    credential: DRAFT_CREDENTIAL,
  })

describe("google_gmail_send of a draft", () => {
  test("reads the draft in full, then posts its id to the draft send route", async () => {
    const h = await sending()
    const result = await h.send({ draft_id: DRAFT_ID })
    const [read, post] = h.calls()
    expect(callOf(read!)).toBe(`GET ${draftUrl(DRAFT_ID)}`)
    expect(read!.url.searchParams.get("format")).toBe("full")
    expect(callOf(post!)).toBe(`POST ${DRAFT_SEND_URL}`)
    expect(post!.json).toEqual({ id: DRAFT_ID })
    expect(result).toEqual({ message_id: "18f3a2b4c5d6e7ff", thread_id: THREAD_ID, labels: ["SENT"] })
  })

  test("a label that may compose, and one that may modify, can send a draft; one that may only send cannot", async () => {
    const modify = {
      ...DRAFT_CREDENTIAL,
      scopes: [...DRAFT_CREDENTIAL.scopes.filter((scope) => scope !== GMAIL_COMPOSE_SCOPE), GMAIL_MODIFY_SCOPE],
    }
    for (const credential of [DRAFT_CREDENTIAL, modify]) {
      const h = await sendFixture({
        handlers: [draftHandler(draftFull()), draftSendHandler],
        credential,
      })
      await h.send({ draft_id: DRAFT_ID })
      expect(h.calls().length).toBe(2)
      await cleanUp()
    }
    const sendOnly = await sendFixture({
      handlers: [draftHandler(draftFull()), draftSendHandler],
      credential: SEND_CREDENTIAL,
    })
    const error = await toolError(sendOnly.send({ draft_id: DRAFT_ID }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("login")
    expect(sendOnly.requests).toEqual([])
  })

  test("a draft that is not found is not_found, and nothing is sent", async () => {
    const h = await sendFixture({
      handlers: [
        { method: "GET", url: draftUrl(DRAFT_ID), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
        draftSendHandler,
      ],
      credential: DRAFT_CREDENTIAL,
    })
    expect((await toolError(h.send({ draft_id: DRAFT_ID }))).code).toBe("not_found")
    expect(h.calls().map((request) => request.method)).toEqual(["GET"])
  })

  test("a Google failure is an error", async () => {
    const h = await sendFixture({
      handlers: [
        draftHandler(draftFull()),
        {
          ...draftSendHandler,
          reply: { status: 400, json: { error: { message: "Invalid To header", status: "INVALID_ARGUMENT" } } },
        },
      ],
      credential: DRAFT_CREDENTIAL,
    })
    const error = await toolError(h.send({ draft_id: DRAFT_ID }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Invalid To header")
  })
})

describe("google_gmail_send of a draft refuses what cannot be sent", () => {
  const mailArguments = {
    to: ["ann@example.test"],
    cc: ["bob@example.test"],
    bcc: ["dee@example.test"],
    subject: "Lunch",
    body: "Hi",
    html: false,
    reply_to: "18f3a2b4c5d6e7f0",
    attachments: ["/x/y"],
  }

  test.each(Object.entries(mailArguments))(
    "`%s` with `draft_id` is invalid_argument, before any request",
    async (name, value) => {
      const h = await sending()
      const error = await toolError(h.send({ draft_id: DRAFT_ID, [name]: value }))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain(`\`${name}\``)
      expect(h.requests).toEqual([])
    },
  )

  test("a draft id that is not an id, and a mail with no to or no body, are invalid_argument before any request", async () => {
    const h = await sending()
    expect((await toolError(h.send({ draft_id: "../x" }))).code).toBe("invalid_argument")
    expect((await toolError(h.send({ subject: "x", body: "x" }))).message).toContain("`to` and `body`")
    expect((await toolError(h.send({ to: ["ann@example.test"], subject: "x" }))).message).toContain("`to` and `body`")
    expect((await toolError(h.send({}))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a draft with no recipient is refused, naming the draft, and nothing is sent", async () => {
    const h = await sending({ Subject: "Notes" })
    const error = await toolError(h.send({ draft_id: DRAFT_ID }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(DRAFT_ID)
    expect(error.message).toContain("no recipient")
    expect(h.calls().map((request) => request.method)).toEqual(["GET"])
  })

  test.each(["To", "Cc", "Bcc"])(
    "a %s header that cannot be read as addresses is refused, naming the draft and not the header's text",
    async (header) => {
      const h = await sending({ ...DRAFT_HEADERS, [header]: "undisclosed-recipients:; secret-text" })
      const error = await toolError(h.send({ draft_id: DRAFT_ID }))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain(DRAFT_ID)
      expect(error.message).toContain(header)
      expect(error.message).not.toContain("secret-text")
      expect(h.calls().map((request) => request.method)).toEqual(["GET"])
    },
  )
})

describe("google_gmail_send targets of a draft", () => {
  const targets = async (headers: Record<string, string>) => (await sending(headers)).targets({ draft_id: DRAFT_ID })

  test("one per address of the draft's To, Cc and Bcc headers, display names dropped, lower-cased and sorted", async () => {
    expect(
      await targets({
        To: '"Ann Lee" <Ann@Example.test>, bob@example.test (Bob)',
        Cc: '"Bo, Bee" <bo@other.test>',
        Bcc: "<dee@example.test>,\r\n Cy <cy@example.test>",
        Subject: "Lunch",
      }),
    ).toEqual([
      "work/recipients/ann@example.test",
      "work/recipients/bo@other.test",
      "work/recipients/bob@example.test",
      "work/recipients/cy@example.test",
      "work/recipients/dee@example.test",
    ])
  })

  test("is `*` when the draft has no recipient, an unreadable header or is not found, and when mail arguments are given", async () => {
    expect(await targets({ Subject: "Notes" })).toEqual(["*"])
    expect(await targets({ To: "Group: ann@example.test;" })).toEqual(["*"])
    const h = await sending()
    expect(await h.targets({ draft_id: DRAFT_ID, body: "x" })).toEqual(["*"])
    const gone = await sendFixture({ handlers: [], credential: DRAFT_CREDENTIAL })
    expect(await gone.targets({ draft_id: DRAFT_ID })).toEqual(["*"])
  })
})
