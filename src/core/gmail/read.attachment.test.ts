import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, readdir, stat } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { toolError } from "../google/client.fixtures"
import {
  MESSAGE_ID,
  answer,
  attachmentUrl,
  callOf,
  cleanUp,
  encoded,
  filePart,
  fixture,
  freshTokens,
  fullMessage,
  messageUrl,
  textPart,
  type Fixture,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STAMP = "20260601-120000"
const ATTACHMENT_ID = "ANGjdJ-opaque_attachment-id"
const PDF = Buffer.from("%PDF-1.4 made up")

const attach = (more: Record<string, unknown> = {}) => ({
  method: "attachment",
  message_id: MESSAGE_ID,
  part: "1",
  ...more,
})

/** A fixture whose message holds a body and the file parts given. */
const withParts = (parts: unknown[], more: Parameters<typeof fixture>[0] = []) =>
  fixture([
    answer(messageUrl(MESSAGE_ID), fullMessage(MESSAGE_ID, [textPart("text/plain", "see file"), ...parts])),
    ...more,
  ])

/** The names in the attachment directory. */
async function saved(h: Fixture): Promise<string[]> {
  return (await readdir(join(h.downloadDir, "gmail-attachments")).catch(() => [])).sort()
}

describe("google_gmail_read attachment", () => {
  test("saves an attachment Gmail inlines, owner only, named for it and the time, and returns where", async () => {
    const h = await withParts([filePart("1", "Q1 report.pdf", { size: PDF.length, data: encoded(PDF) })])

    const result = await h.read(attach())

    const path = join(h.downloadDir, "gmail-attachments", `Q1_report-${STAMP}.pdf`)
    expect(result).toEqual({
      message_id: MESSAGE_ID,
      part: "1",
      filename: "Q1 report.pdf",
      mime_type: "application/pdf",
      size: PDF.length,
      path,
    })
    expect(await readFile(path)).toEqual(PDF)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(h.downloadDir, "gmail-attachments"))).mode & 0o777).toBe(0o700)
    expect(h.calls().map(callOf)).toEqual([`GET ${messageUrl(MESSAGE_ID)}`])
    expect(h.calls()[0]!.url.searchParams.get("format")).toBe("full")
  })

  test("refuses inline data the masking changed, and saves nothing", async () => {
    const shaped = "AIza" + "B".repeat(35)
    const h = await withParts([filePart("1", "key.txt", { size: 40, data: `AAAA${shaped}AAAA` })])

    const error = await toolError(h.read(attach()))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("cannot be saved intact")
    expect(await saved(h)).toEqual([])
  })

  test("fetches an attachment Gmail keeps apart by its attachment id, which the result never holds", async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const h = await withParts(
      [filePart("1", "data.bin", { size: bytes.length, attachmentId: ATTACHMENT_ID })],
      [answer(attachmentUrl(MESSAGE_ID, ATTACHMENT_ID), { size: bytes.length, data: encoded(bytes) })],
    )

    const result = await h.read(attach())

    expect(await readFile(result.path!)).toEqual(bytes)
    expect(h.calls().map(callOf)).toEqual([
      `GET ${messageUrl(MESSAGE_ID)}`,
      `GET ${attachmentUrl(MESSAGE_ID, ATTACHMENT_ID)}`,
    ])
    expect(JSON.stringify(result)).not.toContain("ANGjdJ")
  })

  test("`name` names the file, and is cut down to letters, digits, `_` and `-`", async () => {
    const h = await withParts([filePart("1", "report.pdf", { size: 1, data: encoded("x") })])

    const result = await h.read(attach({ name: "../../etc/pass wd" }))

    expect(result.path).toBe(join(h.downloadDir, "gmail-attachments", `etc_pass_wd-${STAMP}.pdf`))
  })

  test.each([
    ["a plain extension, lower-cased", "scan.PDF", "pdf"],
    ["the last extension of several", "backup.tar.gz", "gz"],
    ["no extension", "README", "bin"],
    ["a hostile extension", "x.p$f;rm", "bin"],
    ["a path in the name", "../../x.Docx", "docx"],
    ["an over-long extension", "x.abcdefghijkl", "bin"],
  ])("the extension comes from the file's own name: %s", async (_name, filename, extension) => {
    const h = await withParts([filePart("1", filename, { size: 1, data: encoded("x") })])

    const result = await h.read(attach())

    expect(dirname(result.path!)).toBe(join(h.downloadDir, "gmail-attachments"))
    expect(extname(result.path!)).toBe(`.${extension}`)
  })

  test("a second save of the same attachment is a new file, never over the first", async () => {
    const h = await withParts([filePart("1", "a.pdf", { size: 3, data: encoded("one") })])

    await h.read(attach())
    await h.read(attach())

    expect(await saved(h)).toEqual([`a-${STAMP}-2.pdf`, `a-${STAMP}.pdf`])
  })

  test("a part that is no attachment, or does not exist, is not_found and nothing is saved", async () => {
    const h = await withParts([filePart("1", "a.pdf", { size: 1, data: encoded("x") })])

    for (const part of ["0", "7", "1.1"]) {
      const error = await toolError(h.read(attach({ part })))
      expect(error.code).toBe("not_found")
      expect(error.message).toContain("`message` lists its attachments and their parts")
    }
    expect(await saved(h)).toEqual([])
  })

  test("a part with no content is upstream_error and nothing is saved", async () => {
    const h = await withParts([filePart("1", "a.pdf", { size: 0 })])

    expect((await toolError(h.read(attach()))).code).toBe("upstream_error")
    expect(await saved(h)).toEqual([])
  })

  test("an attachment Google no longer has is not_found and nothing is saved", async () => {
    const h = await withParts(
      [filePart("1", "a.pdf", { size: 1, attachmentId: ATTACHMENT_ID })],
      [
        {
          method: "GET",
          url: attachmentUrl(MESSAGE_ID, ATTACHMENT_ID),
          reply: { status: 404, json: { error: { code: 404, status: "NOT_FOUND" } } },
        },
      ],
    )

    expect((await toolError(h.read(attach()))).code).toBe("not_found")
    expect(await saved(h)).toEqual([])
  })
})
