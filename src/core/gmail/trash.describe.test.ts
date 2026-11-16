import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { toolError } from "../google/client.fixtures"
import { GMAIL_CREDENTIAL } from "./read.testing"
import { cleanUp, freshTokens, idsOf, mailboxFixture, messagesMetadata, threadsMetadata } from "./mailbox.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const handlers = [messagesMetadata(), threadsMetadata()]

const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex")

describe("google_gmail_trash describe", () => {
  test("headlines the count, shows Count and Deleted after, and lists every message", async () => {
    const h = await mailboxFixture({ handlers })
    const description = await h.trash.describe({ messages: ["m001", "m002"] })
    expect(description.headline).toEqual({
      text: "About to move {count} messages to the trash",
      values: { count: "2" },
    })
    expect(description.facts).toEqual([
      { label: "Count", value: { text: "{count} messages", values: { count: 2 } } },
      { label: "Deleted after", value: { text: "{days} days", values: { days: 30 } } },
    ])
    expect(description.text).toEqual({
      label: "Mail",
      body: [
        "Mon, 1 Jun 2026 09:00:00 +0000 Ann <ann@example.test> — Mail m001",
        "Mon, 1 Jun 2026 09:00:00 +0000 Ann <ann@example.test> — Mail m002",
      ].join("\n"),
    })
  })

  test("one message and threads have their own words", async () => {
    const h = await mailboxFixture({ handlers })
    const one = await h.trash.describe({ messages: ["m001"] })
    expect(one.headline).toEqual({ text: "About to move a message to the trash" })
    expect(one.facts[0]).toEqual({ label: "Count", value: { text: "{count} message", values: { count: 1 } } })
    const thread = await h.trash.describe({ threads: ["t001"] })
    expect(thread.headline).toEqual({ text: "About to move a thread to the trash" })
    expect(thread.facts[0]!.value).toEqual({ text: "{count} thread", values: { count: 1 } })
    expect(thread.text!.body).toBe("Mon, 1 Jun 2026 09:00:00 +0000 Ann <ann@example.test> — Thread t001")
    const threads = await h.trash.describe({ threads: ["t001", "t002"] })
    expect(threads.headline).toEqual({ text: "About to move {count} threads to the trash", values: { count: "2" } })
    expect(threads.facts[0]!.value).toEqual({ text: "{count} threads", values: { count: 2 } })
  })

  test("all 100 items are listed, with no `+N more`", async () => {
    const h = await mailboxFixture({ handlers })
    const description = await h.trash.describe({ messages: idsOf("m", 100) })
    const lines = description.text!.body.split("\n")
    expect(lines).toHaveLength(100)
    expect(lines.at(-1)).toEndWith("Mail m100")
  })

  test("pins one digest of every id with its history id, in the order given", async () => {
    const h = await mailboxFixture({ handlers })
    const description = await h.trash.describe({ messages: ["m002", "m001"] })
    expect(description.pins).toEqual({ items: digest(["m002:m002-h1", "m001:m001-h1"]) })
  })

  test("the pin changes when the mail does, since its history id does", async () => {
    const before = await (await mailboxFixture({ handlers })).trash.describe({ messages: ["m001", "m002"] })
    const changed = await mailboxFixture({
      handlers: [messagesMetadata((id) => (id === "m002" ? "m002-h2" : `${id}-h1`))],
    })
    const after = await changed.trash.describe({ messages: ["m001", "m002"] })
    expect(after.pins!.items).not.toBe(before.pins!.items)
    expect(after.text).toEqual(before.text)
    const again = await (await mailboxFixture({ handlers })).trash.describe({ messages: ["m001", "m002"] })
    expect(again.pins).toEqual(before.pins)
  })

  test("the pin of a thread changes with the thread's history id", async () => {
    const before = await (await mailboxFixture({ handlers })).trash.describe({ threads: ["t001"] })
    const changed = await mailboxFixture({ handlers: [threadsMetadata(() => "later")] })
    expect((await changed.trash.describe({ threads: ["t001"] })).pins!.items).not.toBe(before.pins!.items)
  })

  test("describe throws where execute would: a mail that is gone, a label without gmail.modify, a bad selection", async () => {
    const gone = await mailboxFixture({
      handlers: [
        { method: "GET", url: /\/messages\//, reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
      ],
    })
    expect((await toolError(gone.trash.describe({ messages: ["m001"] }))).code).toBe("not_found")
    const readOnly = await mailboxFixture({ handlers, credential: GMAIL_CREDENTIAL })
    expect((await toolError(readOnly.trash.describe({ messages: ["m001"] }))).code).toBe("unauthenticated")
    expect(readOnly.calls()).toEqual([])
    const both = (await mailboxFixture({ handlers })).trash.describe({ messages: ["m001"], threads: ["t001"] })
    expect((await toolError(both)).code).toBe("invalid_argument")
  })
})
