import { describe, expect, test } from "bun:test"
import { htmlToText } from "./html-text"
import { buildMime, type MimeMessage } from "./mime"
import { MESSAGE, findType, parseMime } from "./mime.testing"

const build = (overrides: Partial<MimeMessage> = {}) => Buffer.from(buildMime({ ...MESSAGE, ...overrides })).toString()

const textOf = (part: { content?: Buffer }) => part.content?.toString("utf8")

describe("buildMime body", () => {
  test("text alone is one text/plain part in UTF-8, base64, with CRLF line breaks", () => {
    const mail = parseMime(build({ body: "Line one\nLine two\r\nあいう" }))
    expect(mail.type).toBe("text/plain")
    expect(mail.headers["content-type"]).toBe("text/plain; charset=UTF-8")
    expect(mail.headers["content-transfer-encoding"]).toBe("base64")
    expect(textOf(mail)).toBe("Line one\r\nLine two\r\nあいう")
  })

  test("base64 lines hold at most 76 characters", () => {
    const raw = build({ body: "x".repeat(500) })
    const lines = raw.split("\r\n").slice(-8)
    expect(Math.max(...lines.map((line) => line.length))).toBe(76)
    expect(lines.every((line) => line.length <= 76)).toBe(true)
  })

  test("every line ends in CRLF, never a bare LF or CR", () => {
    const raw = build({
      body: "a\nb\rc",
      cc: ["bob@example.test"],
      attachments: [{ name: "a.txt", bytes: Buffer.from("x\ny") }],
    })
    expect(raw.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/)
  })

  test("html is a multipart/alternative with the text of the HTML first and the HTML last", () => {
    const html = "<p>Hello <b>Ann</b></p><p>See you</p>"
    const mail = parseMime(build({ body: html, html: true }))
    expect(mail.type).toBe("multipart/alternative")
    expect(mail.parts?.map((part) => part.type)).toEqual(["text/plain", "text/html"])
    expect(textOf(mail.parts![0]!)).toBe(htmlToText(html).replace(/\r?\n/g, "\r\n"))
    expect(textOf(mail.parts![1]!)).toBe(html)
    expect(mail.parts![1]!.headers["content-type"]).toBe("text/html; charset=UTF-8")
  })

  test("a body that holds a boundary-looking line is only ever base64 in the part", () => {
    const mail = parseMime(build({ body: "--=_abc\r\n--=_abc--" }))
    expect(textOf(mail)).toBe("--=_abc\r\n--=_abc--")
  })

  test("the text alternative keeps list items and headings on lines and separates table cells with tabs", () => {
    const body = "<p>a</p><ul><li>one</li><li>two</li></ul><h2>t</h2><table><tr><td>x</td><td>y</td></tr></table>"
    const mail = parseMime(build({ body, html: true }))
    expect(textOf(mail.parts![0]!)).toBe("a\r\none\r\ntwo\r\n\r\nt\r\nx\ty")
    expect(textOf(mail.parts![1]!)).toBe(body)
  })
})

describe("buildMime attachments", () => {
  const files = [
    { name: "Report.PDF", bytes: Buffer.from([0, 1, 2, 250, 251, 252]) },
    { name: "notes.txt", bytes: Buffer.from("plain notes") },
    { name: "archive.weird", bytes: Buffer.from("zz") },
    { name: "empty.csv", bytes: new Uint8Array() },
  ]

  test("wrap the content in multipart/mixed, in the order given, with their types and content", () => {
    const mail = parseMime(build({ attachments: files }))
    expect(mail.type).toBe("multipart/mixed")
    const [content, ...attached] = mail.parts!
    expect(content!.type).toBe("text/plain")
    expect(attached.map((part) => part.type)).toEqual([
      "application/pdf",
      "text/plain",
      "application/octet-stream",
      "text/csv",
    ])
    expect(attached.map((part) => [...part.content!])).toEqual(files.map((file) => [...file.bytes]))
  })

  test("are marked as attachments with their file names", () => {
    const mail = parseMime(build({ attachments: files }))
    expect(mail.parts!.slice(1).map((part) => part.headers["content-disposition"])).toEqual([
      'attachment; filename="Report.PDF"',
      'attachment; filename="notes.txt"',
      'attachment; filename="archive.weird"',
      'attachment; filename="empty.csv"',
    ])
    expect(mail.parts!.every((part) => part.headers["content-transfer-encoding"] === "base64")).toBe(true)
  })

  test("sit beside the text and the HTML of an html mail, not inside the alternative", () => {
    const mail = parseMime(build({ html: true, body: "<p>Hi</p>", attachments: [files[1]!] }))
    expect(mail.type).toBe("multipart/mixed")
    expect(mail.parts!.map((part) => part.type)).toEqual(["multipart/alternative", "text/plain"])
    expect(findType(mail, "text/html")).toBeDefined()
  })

  test("base64 lines of an attachment hold at most 76 characters", () => {
    const mail = parseMime(build({ attachments: [{ name: "big.bin", bytes: Buffer.alloc(1000, 7) }] }))
    const lines = mail.parts![1]!.raw.split("\r\n\r\n")[1]!.split("\r\n")
    expect(lines.length).toBe(Math.ceil((1000 * 4) / 3 / 76))
    expect(lines.every((line) => line.length <= 76)).toBe(true)
  })

  test("a name with a quote, a backslash or a non-ASCII letter is also given as RFC 2231 filename*", () => {
    const names = ['a "b".txt', "a\\b.txt", "レポート.txt", "line\nbreak.txt"]
    const mail = parseMime(build({ attachments: names.map((name) => ({ name, bytes: Buffer.from("x") })) }))
    expect(mail.parts!.slice(1).map((part) => part.headers["content-disposition"])).toEqual([
      "attachment; filename=\"a _b_.txt\"; filename*=UTF-8''a%20%22b%22.txt",
      "attachment; filename=\"a_b.txt\"; filename*=UTF-8''a%5Cb.txt",
      "attachment; filename=\"____.txt\"; filename*=UTF-8''%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88.txt",
      "attachment; filename=\"line_break.txt\"; filename*=UTF-8''line%0Abreak.txt",
    ])
  })

  test("a very long non-ASCII name is folded within the line limit", () => {
    const name = `${"長".repeat(80)}.txt`
    const mail = parseMime(build({ attachments: [{ name, bytes: Buffer.from("x") }] }))
    const header = mail.parts![1]!.rawHeaders.split("\r\n")
    expect(header.every((line) => line.length < 998)).toBe(true)
    expect(mail.parts![1]!.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent("長".repeat(80))}.txt`,
    )
  })
})

describe("buildMime boundaries", () => {
  test("are random, differ between nested parts and between calls, and appear in no content", () => {
    const options = { html: true, body: "<p>Hi</p>", attachments: [{ name: "a.txt", bytes: Buffer.from("x") }] }
    const first = build(options)
    const second = build(options)
    const boundaries = (raw: string) => [...raw.matchAll(/boundary="([^"]+)"/g)].map((match) => match[1]!)
    const [outer, inner] = boundaries(first)
    expect(outer).not.toBe(inner)
    expect(boundaries(second)).not.toContain(outer)
    const uses = first.split(outer!).length - 1
    expect(uses).toBe(1 + 2 + 1)
    const mail = parseMime(first)
    for (const part of mail.parts!.flatMap((child) => child.parts ?? [child])) {
      expect(part.raw).not.toContain(outer!)
    }
  })
})
