import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { buildMime, type MimeMessage } from "./mime"
import { MESSAGE, parseMime } from "./mime.testing"

const build = (overrides: Partial<MimeMessage> = {}) => Buffer.from(buildMime({ ...MESSAGE, ...overrides })).toString()

const headersOf = (overrides: Partial<MimeMessage> = {}) => parseMime(build(overrides)).headers

/** The subject as a mail client reads it: each encoded word decoded and the words joined. */
function decodedSubject(subject: string): string {
  return [...subject.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)]
    .map((match) => Buffer.from(match[1]!, "base64").toString("utf8"))
    .join("")
}

function refusal(overrides: Partial<MimeMessage>): ToolError {
  try {
    buildMime({ ...MESSAGE, ...overrides })
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected the mail to be refused")
}

describe("buildMime headers", () => {
  test("sets To, Cc, Bcc, Subject, Date and MIME-Version, and leaves From and Message-ID to Gmail", () => {
    const headers = headersOf({ cc: ["bob@example.test", "cy@example.test"], bcc: ["dee@example.test"] })
    expect(headers).toMatchObject({
      to: "ann@example.test",
      cc: "bob@example.test, cy@example.test",
      bcc: "dee@example.test",
      subject: "Lunch",
      date: "Mon, 16 Nov 2026 09:08:07 +0000",
      "mime-version": "1.0",
    })
    expect(headers).not.toHaveProperty("from")
    expect(headers).not.toHaveProperty("message-id")
    expect(headers).not.toHaveProperty("in-reply-to")
    expect(headers).not.toHaveProperty("references")
  })

  test("leaves out Cc and Bcc when there is none", () => {
    const headers = headersOf()
    expect(headers).not.toHaveProperty("cc")
    expect(headers).not.toHaveProperty("bcc")
  })

  test("a reply carries In-Reply-To and References", () => {
    const headers = headersOf({ inReplyTo: "<b@example.test>", references: "<a@example.test> <b@example.test>" })
    expect(headers["in-reply-to"]).toBe("<b@example.test>")
    expect(headers.references).toBe("<a@example.test> <b@example.test>")
  })

  test("folds a long address list between addresses, and the lines unfold to the list", () => {
    const to = Array.from({ length: 100 }, (_, index) => `person${index}@example.test`)
    const raw = build({ to })
    const block = raw.slice(0, raw.indexOf("\r\n\r\n"))
    expect(block.split("\r\n").every((line) => line.length <= 76)).toBe(true)
    expect(headersOf({ to }).to).toBe(to.join(", "))
  })

  test("folds a long ASCII subject at its spaces and keeps it whole when unfolded", () => {
    const subject = Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ")
    expect(headersOf({ subject }).subject).toBe(subject)
    expect(
      build({ subject })
        .split("\r\n")
        .some((line) => line.startsWith(" word")),
    ).toBe(true)
  })
})

describe("buildMime subject", () => {
  test("an ASCII subject is written as it is", () => {
    expect(build({ subject: "Re: Q3 plan (draft)" })).toContain("Subject: Re: Q3 plan (draft)\r\n")
  })

  test("a non-ASCII subject is RFC 2047 encoded words in UTF-8 base64", () => {
    const raw = build({ subject: "ランチの件" })
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("ランチの件").toString("base64")}?=\r\n`)
    expect(decodedSubject(headersOf({ subject: "ランチの件" }).subject!)).toBe("ランチの件")
  })

  test("a long non-ASCII subject is several words of at most 75 characters, none cut inside a character", () => {
    const subject = `会議の議事録 ${"🍣".repeat(40)} ${"あ".repeat(60)}`
    const header = build({ subject })
    const words = [...header.matchAll(/=\?UTF-8\?B\?[^?]*\?=/g)].map((match) => match[0])
    expect(words.length).toBeGreaterThan(3)
    expect(words.every((word) => word.length <= 75)).toBe(true)
    expect(decodedSubject(headersOf({ subject }).subject!)).toBe(subject)
  })

  test("an ASCII subject that looks like an encoded word is encoded, so it cannot pose as one", () => {
    const subject = "=?UTF-8?B?aGk=?= hello"
    expect(build({ subject })).not.toContain(`Subject: ${subject}`)
    expect(decodedSubject(headersOf({ subject }).subject!)).toBe(subject)
  })

  test("an empty subject is an empty header", () => {
    expect(build({ subject: "" })).toContain("Subject: \r\n")
  })
})

describe("buildMime refusals", () => {
  const BREAKS = ["a\nb", "a\rb", "a\r\nBcc: eve@example.test"]

  test.each(BREAKS)("a line break in the subject is invalid_argument: %j", (subject) => {
    expect(refusal({ subject }).code).toBe("invalid_argument")
  })

  test.each(BREAKS)("a line break in an address is invalid_argument, in to, cc and bcc: %j", (value) => {
    const address = `ann${value}@example.test`
    for (const field of ["to", "cc", "bcc"] as const) {
      const error = refusal({ [field]: [address] })
      expect([field, error.code]).toEqual([field, "invalid_argument"])
      expect(error.message).not.toContain("Bcc: eve")
    }
  })

  test.each(["inReplyTo", "references"] as const)("a line break in %s is invalid_argument", (field) => {
    expect(refusal({ [field]: "<a@example.test>\r\nBcc: eve@example.test" }).code).toBe("invalid_argument")
  })

  test("an address that is not plain ASCII is invalid_argument", () => {
    expect(refusal({ to: ["ånn@example.test"] }).code).toBe("invalid_argument")
  })
})
