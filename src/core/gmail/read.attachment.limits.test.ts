import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { FAKE_ACCESS_TOKEN } from "../google/fake-google.testing"
import { invoke } from "../tool"
import { googleGmailRead } from "./read"
import {
  MESSAGE_ID,
  answer,
  attachmentUrl,
  callOf,
  cleanUp,
  filePart,
  fixture,
  freshTokens,
  fullMessage,
  messageUrl,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const MIB = 1024 * 1024
const ATTACHMENT_ID = "ANGjdJ-opaque_attachment-id"

const attach = { method: "attachment", message_id: MESSAGE_ID, part: "1" }

/** A fixture whose message holds the one file part given, plus the attachment reply when there is one. */
const withFile = (body: { size: number; data?: string; attachmentId?: string }, attachment?: unknown) =>
  fixture([
    answer(messageUrl(MESSAGE_ID), fullMessage(MESSAGE_ID, [filePart("1", "big.bin", body)])),
    ...(attachment === undefined ? [] : [answer(attachmentUrl(MESSAGE_ID, ATTACHMENT_ID), attachment)]),
  ])

describe("google_gmail_read attachment size", () => {
  test("an attachment of 25 MiB is saved", async () => {
    const data = Buffer.alloc(25 * MIB, 7).toString("base64url")
    const h = await withFile({ size: 25 * MIB, attachmentId: ATTACHMENT_ID }, { data })

    const result = await h.read(attach)

    expect(result.size).toBe(25 * MIB)
  })

  test("one Gmail says is over 25 MiB is invalid_argument before its content is fetched", async () => {
    const h = await withFile({ size: 25 * MIB + 1, attachmentId: ATTACHMENT_ID }, { data: "AAAA" })

    const error = await toolError(h.read(attach))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The attachment is 26214401 bytes; attachment saves at most 25 MiB.")
    expect(h.calls().map(callOf)).toEqual([`GET ${messageUrl(MESSAGE_ID)}`])
  })

  test("one whose content is over 25 MiB whatever its declared size is refused and nothing is saved", async () => {
    const data = Buffer.alloc(25 * MIB + 1, 7).toString("base64url")
    const h = await withFile({ size: 10, attachmentId: ATTACHMENT_ID }, { data })

    expect((await toolError(h.read(attach))).code).toBe("invalid_argument")
    expect(await readdir(h.downloadDir)).toEqual([])
  })
})

describe("google_gmail_read attachment masking", () => {
  /** What the one saved file holds. */
  async function savedContent(h: Awaited<ReturnType<typeof withFile>>, result: { path?: string }) {
    expect(result.path).toStartWith(join(h.downloadDir, "gmail-attachments"))
    return readFile(result.path!)
  }

  test("data shaped like an API key is saved byte for byte", async () => {
    const lookalike = ["AIza", "A".repeat(35)].join("")
    const data = `AAAA${lookalike}AAAA`
    const h = await withFile({ size: 40, attachmentId: ATTACHMENT_ID }, { data })

    const result = await h.read(attach)

    expect(await savedContent(h, result)).toEqual(Buffer.from(data, "base64url"))
    expect(result.size).toBe(Buffer.from(data, "base64url").length)
  })

  test("the label's own access token in the data is still masked, so the file differs", async () => {
    const data = `AAAA${FAKE_ACCESS_TOKEN}AAAA`
    const h = await withFile({ size: 40, attachmentId: ATTACHMENT_ID }, { data })

    const result = await h.read(attach)

    const content = await savedContent(h, result)
    expect(content).toEqual(Buffer.from("AAAA[masked]AAAA", "base64url"))
    expect(content).not.toEqual(Buffer.from(data, "base64url"))
  })
})

describe("google_gmail_read attachment download directory", () => {
  test("a download directory inside the state directory is forbidden and nothing is written there", async () => {
    const h = await withFile({ size: 4, data: "AAAA" })
    const ctx = { ...h.ctx, downloadDir: join(h.stateDir, "downloads") }

    const error = await toolError(invoke(googleGmailRead, attach, ctx))

    expect(error.code).toBe("forbidden")
    expect(await readdir(h.stateDir)).not.toContain("downloads")
  })

  test("the install directory is no place for a download either", async () => {
    const h = await withFile({ size: 4, data: "AAAA" })
    const ctx = { ...h.ctx, ownDir: h.downloadDir }

    expect((await toolError(invoke(googleGmailRead, attach, ctx))).code).toBe("forbidden")
    expect(await readdir(h.downloadDir)).toEqual([])
  })

  test("a missing or relative download directory is internal_error, before any request", async () => {
    const h = await withFile({ size: 4, data: "AAAA" })
    for (const downloadDir of [undefined, "relative/downloads"]) {
      const error = await toolError(invoke(googleGmailRead, attach, { ...h.ctx, downloadDir }))
      expect(error.code).toBe("internal_error")
    }
    expect(h.calls()).toHaveLength(0)
  })
})
