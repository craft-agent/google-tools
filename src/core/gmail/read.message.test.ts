import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  MESSAGE_ID,
  THREAD_ID,
  answer,
  cleanUp,
  encoded,
  filePart,
  fixture,
  freshTokens,
  fullMessage,
  messageUrl,
  textPart,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** Reads the message made of `parts`. */
async function readParts(parts: unknown[], headers?: Record<string, string>) {
  const h = await fixture([answer(messageUrl(MESSAGE_ID), fullMessage(MESSAGE_ID, parts, headers))])
  return h.read({ method: "message", message_id: MESSAGE_ID })
}

describe("google_gmail_read message", () => {
  test("returns the headers, the labels and a text body", async () => {
    const h = await fixture([
      answer(
        messageUrl(MESSAGE_ID),
        fullMessage(MESSAGE_ID, [textPart("text/plain", "Lunch at noon?\nBring Bo.")], {
          From: "Ann <ann@example.test>",
          To: "me@example.test",
          Cc: "bo@example.test",
          Bcc: "cy@example.test",
          "Reply-To": "list@example.test",
          Subject: "Lunch",
          Date: "Mon, 1 Jun 2026 09:00:00 +0000",
          "Message-ID": "<CAMadeUp123@mail.example.test>",
        }),
      ),
    ])

    const result = await h.read({ method: "message", message_id: MESSAGE_ID })

    expect(result).toEqual({
      message_id: MESSAGE_ID,
      thread_id: THREAD_ID,
      from: "Ann <ann@example.test>",
      to: "me@example.test",
      cc: "bo@example.test",
      bcc: "cy@example.test",
      reply_to: "list@example.test",
      subject: "Lunch",
      date: "Mon, 1 Jun 2026 09:00:00 +0000",
      message_id_header: "<CAMadeUp123@mail.example.test>",
      labels: ["INBOX", "UNREAD"],
      body: "Lunch at noon?\nBring Bo.",
      body_format: "text",
      body_truncated: false,
      attachments: [],
    })
    const [call] = h.calls()
    expect(call!.url.searchParams.get("format")).toBe("full")
  })

  test("header names are matched in any case and an absent one is null", async () => {
    const result = await readParts([textPart("text/plain", "x")], { SUBJECT: "Loud", "message-id": "<a@b.test>" })

    expect(result).toMatchObject({ subject: "Loud", message_id_header: "<a@b.test>", from: null, bcc: null })
  })

  test("joins the text parts, found at any depth, and ignores the HTML beside them", async () => {
    const result = await readParts([
      {
        partId: "0",
        mimeType: "multipart/alternative",
        body: { size: 0 },
        parts: [
          textPart("text/plain", "First", "0.0"),
          textPart("text/html", "<p>First, in HTML</p>", "0.1"),
          textPart("text/plain", "Second", "0.2"),
        ],
      },
    ])

    expect(result).toMatchObject({ body: "First\nSecond", body_format: "text" })
  })

  test("a message with only HTML reads as text: no script or style, line ends kept, entities decoded", async () => {
    const html =
      "<html><head><style>p { color: red }</style><script>alert('x')</script></head>" +
      "<body><p>Fish &amp; chips&nbsp;&#8364;5</p><p>Line one<br>Line two</p><div>&lt;b&gt; &#x41;</div></body></html>"

    const result = await readParts([textPart("text/html", html)])

    expect(result).toMatchObject({ body: "Fish & chips €5\nLine one\nLine two\n<b> A", body_format: "html_as_text" })
  })

  test("a message with no text part has an empty body", async () => {
    const result = await readParts([filePart("1", "a.pdf", { size: 3, data: encoded("abc") })])

    expect(result).toMatchObject({ body: "", body_format: "none", body_truncated: false })
  })

  test("HTML-only mail keeps list items and headings on lines and separates table cells with tabs", async () => {
    const html = "<p>a</p><ul><li>one</li><li>two</li></ul><h2>t</h2><table><tr><td>x</td><td>y</td></tr></table>"
    const result = await readParts([textPart("text/html", html)])
    expect(result).toMatchObject({ body: "a\none\ntwo\n\nt\nx\ty", body_format: "html_as_text" })
  })

  test("a text part that is an attachment is no body", async () => {
    const result = await readParts([
      { ...textPart("text/plain", "notes in a file", "1"), filename: "notes.txt" },
      textPart("text/plain", "the body", "0"),
    ])

    expect(result).toMatchObject({
      body: "the body",
      attachments: [{ part: "1", filename: "notes.txt", mime_type: "text/plain", size: 15 }],
    })
  })

  test("decodes the body as UTF-8, a bad byte becoming a replacement character", async () => {
    const bytes = Buffer.concat([Buffer.from("café 日本 "), Buffer.from([0xff]), Buffer.from(" end")])
    const result = await readParts([
      { partId: "0", mimeType: "text/plain", filename: "", body: { size: bytes.length, data: encoded(bytes) } },
    ])

    expect(result).toMatchObject({ body: "café 日本 \uFFFD end" })
  })

  test("lists the attachments with the part, the name, the type and the size, and never an attachment id", async () => {
    const result = await readParts([
      textPart("text/plain", "see attached", "0"),
      filePart("1", "report.pdf", { size: 120_000, attachmentId: "ANGjdJ-opaque-id" }),
      filePart("2", "logo.png", { size: 4, data: encoded("png!") }, "image/png"),
    ])

    expect(result.attachments).toEqual([
      { part: "1", filename: "report.pdf", mime_type: "application/pdf", size: 120_000 },
      { part: "2", filename: "logo.png", mime_type: "image/png", size: 4 },
    ])
    expect(JSON.stringify(result)).not.toContain("ANGjdJ")
  })
})

describe("google_gmail_read message body limits", () => {
  test("a body of 20,000 characters is whole", async () => {
    const result = await readParts([textPart("text/plain", "a".repeat(20_000))])

    expect(result.body).toHaveLength(20_000)
    expect(result.body_truncated).toBe(false)
  })

  test("a longer body is cut at 20,000 characters and says so", async () => {
    const result = await readParts([textPart("text/plain", "b".repeat(20_001))])

    expect(result.body).toBe("b".repeat(20_000))
    expect(result.body_truncated).toBe(true)
  })

  test("the cut counts characters, not UTF-16 units, and never splits one", async () => {
    const result = await readParts([textPart("text/plain", "😀".repeat(20_001))])

    expect(Array.from(result.body!)).toHaveLength(20_000)
    expect(result.body!.endsWith("😀")).toBe(true)
    expect(result.body_truncated).toBe(true)
  })

  test("a long HTML body is cut after it is turned into text", async () => {
    const result = await readParts([textPart("text/html", `<p>${"c".repeat(25_000)}</p>`)])

    expect(result.body).toBe("c".repeat(20_000))
    expect(result.body_truncated).toBe(true)
  })

  test("text shaped like a Google credential in a body is masked", async () => {
    const token = ["ya29", "madeUpAccessToken0123456789"].join(".")

    const result = await readParts([textPart("text/plain", `token: ${token} end`)])

    expect(result.body).toBe("token: [masked] end")
  })
})
