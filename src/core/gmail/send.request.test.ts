import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { MESSAGE_ID, THREAD_ID, answer, messageUrl } from "./read.testing"
import {
  SEND_URL,
  SENT,
  callOf,
  cleanUp,
  freshTokens,
  originalHandler,
  removeUploads,
  sendFixture,
  sendHandler,
  sentMail,
} from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const base = { to: ["ann@example.test"], subject: "Lunch", body: "Are we still on?" }

describe("google_gmail_send request", () => {
  test("posts a multipart/related body: the JSON part, then the mail as message/rfc822, on the upload route", async () => {
    const h = await sendFixture()
    await h.send(base)
    const [request] = h.sends()
    expect(callOf(request!)).toBe(`POST ${SEND_URL}`)
    expect(request!.url.searchParams.get("uploadType")).toBe("multipart")
    const { type, metadata, mail } = sentMail(request!)
    expect(type).toStartWith("multipart/related; boundary=")
    expect(metadata).toEqual({})
    expect(mail.headers).toMatchObject({ to: "ann@example.test", subject: "Lunch", "mime-version": "1.0" })
    expect(mail.content?.toString()).toBe("Are we still on?")
  })

  test("returns the sent message's id, thread and labels", async () => {
    const h = await sendFixture()
    expect(await h.send(base)).toEqual({ message_id: SENT.id, thread_id: SENT.threadId, labels: ["SENT"] })
  })

  test("returns empty ids rather than failing when Google answers a sent mail without them", async () => {
    const h = await sendFixture({ handlers: [{ method: "POST", url: SEND_URL, reply: { json: {} } }] })
    expect(await h.send(base)).toEqual({ message_id: "", thread_id: "", labels: [] })
  })

  test("sends to, cc and bcc, an html body beside its text, and attachments from the upload directory", async () => {
    const h = await sendFixture({ files: { "report.pdf": "%PDF-1", "ノート.txt": "メモ" } })
    await h.send({
      ...base,
      cc: ["bob@example.test"],
      bcc: ["dee@example.test"],
      body: "<p>Hi <b>Ann</b></p>",
      html: true,
      attachments: [`${h.uploadDir}/report.pdf`, `${h.uploadDir}/ノート.txt`],
    })
    const { mail } = sentMail(h.sends()[0]!)
    expect(mail.headers).toMatchObject({ cc: "bob@example.test", bcc: "dee@example.test" })
    expect(mail.type).toBe("multipart/mixed")
    const [content, pdf, note] = mail.parts!
    expect(content!.parts!.map((part) => part.type)).toEqual(["text/plain", "text/html"])
    expect(content!.parts![1]!.content?.toString()).toBe("<p>Hi <b>Ann</b></p>")
    expect([pdf!.type, pdf!.content?.toString()]).toEqual(["application/pdf", "%PDF-1"])
    expect(note!.headers["content-disposition"]).toContain("filename*=UTF-8''%E3%83%8E%E3%83%BC%E3%83%88.txt")
    expect(note!.content?.toString()).toBe("メモ")
  })

  test("sends a non-ASCII subject as encoded words", async () => {
    const h = await sendFixture()
    await h.send({ ...base, subject: "ランチの件" })
    const raw = Buffer.from(h.sends()[0]!.bytes!).toString("latin1")
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("ランチの件").toString("base64")}?=`)
  })

  test("a Google failure is an error, and the mail's text is in none of it", async () => {
    const h = await sendFixture({
      handlers: [
        {
          method: "POST",
          url: SEND_URL,
          reply: { status: 400, json: { error: { message: "Invalid To header", status: "INVALID_ARGUMENT" } } },
        },
      ],
    })
    const error = await toolError(h.send(base))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Invalid To header")
    expect(error.message).not.toContain("Are we still on")
  })
})

describe("google_gmail_send replies", () => {
  const reply = { to: ["ann@example.test"], reply_to: MESSAGE_ID, body: "Yes." }

  test("reads the original's thread and headers, and sends the reply in that thread with In-Reply-To and References", async () => {
    const h = await sendFixture({ handlers: [originalHandler(), sendHandler] })
    await h.send(reply)
    const [read] = h.calls()
    expect(read!.url.pathname).toBe(`/gmail/v1/users/me/messages/${MESSAGE_ID}`)
    expect(read!.url.searchParams.get("format")).toBe("metadata")
    expect(read!.url.searchParams.getAll("metadataHeaders")).toEqual(["Message-ID", "References", "Subject"])
    const { metadata, mail } = sentMail(h.sends()[0]!)
    expect(metadata).toEqual({ threadId: THREAD_ID })
    expect(mail.headers).toMatchObject({
      "in-reply-to": "<original-1@example.test>",
      references: "<root@example.test> <original-1@example.test>",
      subject: "Re: Lunch",
    })
  })

  test("references hold just the original's id when it had none", async () => {
    const h = await sendFixture({
      handlers: [
        answer(messageUrl(MESSAGE_ID), {
          id: MESSAGE_ID,
          threadId: THREAD_ID,
          payload: { headers: [{ name: "message-id", value: "<only@example.test>" }] },
        }),
        sendHandler,
      ],
    })
    await h.send(reply)
    const { mail } = sentMail(h.sends()[0]!)
    expect(mail.headers.references).toBe("<only@example.test>")
    expect(mail.headers.subject).toBe("Re:")
  })

  test("a given subject wins, and an original already marked Re: is kept as it is", async () => {
    const given = await sendFixture({ handlers: [originalHandler(), sendHandler] })
    await given.send({ ...reply, subject: "Another subject" })
    expect(sentMail(given.sends()[0]!).mail.headers.subject).toBe("Another subject")

    await cleanUp()
    const marked = await sendFixture({ handlers: [originalHandler({ Subject: "RE: Lunch" }), sendHandler] })
    await marked.send(reply)
    expect(sentMail(marked.sends()[0]!).mail.headers.subject).toBe("RE: Lunch")
  })

  test("folded References and a folded subject of the original are read as one line", async () => {
    const h = await sendFixture({
      handlers: [
        originalHandler({ References: "<a@example.test>\r\n <b@example.test>", Subject: "Long\r\n subject" }),
        sendHandler,
      ],
    })
    await h.send(reply)
    const { mail } = sentMail(h.sends()[0]!)
    expect(mail.headers.references).toBe("<a@example.test> <b@example.test> <original-1@example.test>")
    expect(mail.headers.subject).toBe("Re: Long subject")
  })

  test("an original with no Message-ID cannot be replied to, and nothing is sent", async () => {
    const h = await sendFixture({
      handlers: [
        answer(messageUrl(MESSAGE_ID), { id: MESSAGE_ID, threadId: THREAD_ID, payload: { headers: [] } }),
        sendHandler,
      ],
    })
    const error = await toolError(h.send(reply))
    expect(error.code).toBe("upstream_error")
    expect(h.sends()).toEqual([])
  })

  test("a message that is not found fails the reply and nothing is sent", async () => {
    const h = await sendFixture({
      handlers: [
        {
          method: "GET",
          url: messageUrl(MESSAGE_ID),
          reply: { status: 404, json: { error: { status: "NOT_FOUND" } } },
        },
        sendHandler,
      ],
    })
    expect((await toolError(h.send(reply))).code).toBe("not_found")
    expect(h.sends()).toEqual([])
  })

  test("a message id that is not an id is invalid_argument, before any request", async () => {
    const h = await sendFixture()
    expect((await toolError(h.send({ ...reply, reply_to: "../x" }))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("a new mail without a subject is invalid_argument, before any request", async () => {
    const h = await sendFixture()
    const error = await toolError(h.send({ to: ["ann@example.test"], body: "x" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("subject")
    expect(h.calls()).toEqual([])
  })
})
