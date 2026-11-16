import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  BATCH_MODIFY_URL,
  MAILBOX_LABELS,
  cleanUp,
  freshTokens,
  labelsHandler,
  mailboxFixture,
  postHandler,
} from "./mailbox.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const modify = postHandler(BATCH_MODIFY_URL)

/** A fixture whose mailbox holds `MAILBOX_LABELS` and takes a modification. */
const open = (labels: unknown[] = MAILBOX_LABELS) => mailboxFixture({ handlers: [labelsHandler(labels), modify] })

const base = { messages: ["m001"] }

describe("google_gmail_label naming labels", () => {
  test("system ids are used as they are, and the list gives their names", async () => {
    const h = await open()
    const result = await h.label.run({ ...base, add_labels: ["STARRED"], remove_labels: ["INBOX", "UNREAD"] })
    expect(result).toMatchObject({ adds: ["STARRED"], removes: ["INBOX", "UNREAD"] })
    expect(h.writes()[0]!.json).toEqual({
      ids: ["m001"],
      addLabelIds: ["STARRED"],
      removeLabelIds: ["INBOX", "UNREAD"],
    })
  })

  test("every changeable system id is accepted, even where the list does not hold it", async () => {
    const h = await open([])
    const ids = [
      "IMPORTANT",
      "CATEGORY_PERSONAL",
      "CATEGORY_SOCIAL",
      "CATEGORY_PROMOTIONS",
      "CATEGORY_UPDATES",
      "CATEGORY_FORUMS",
    ]
    await h.label.run({ ...base, add_labels: ids })
    expect((h.writes()[0]!.json as { addLabelIds: string[] }).addLabelIds).toEqual(ids)
  })

  test("a user label is found by exact name, by id, and by name ignoring case, and is then used by its id", async () => {
    for (const reference of ["Work/Invoices", "Label_2", "work/INVOICES"]) {
      const h = await open()
      const result = await h.label.run({ ...base, add_labels: [reference] })
      expect(result.adds).toEqual(["Work/Invoices"])
      expect((h.writes()[0]!.json as { addLabelIds: string[] }).addLabelIds).toEqual(["Label_2"])
    }
  })

  test("an exact name wins over another label that matches ignoring case", async () => {
    const h = await open([
      { id: "Label_7", name: "Bills", type: "user" },
      { id: "Label_8", name: "bills", type: "user" },
    ])
    expect((await h.label.run({ ...base, add_labels: ["bills"] })).adds).toEqual(["bills"])
  })

  test("a name that matches several labels only ignoring case is refused, naming them with their ids", async () => {
    const h = await open([
      { id: "Label_7", name: "Bills", type: "user" },
      { id: "Label_8", name: "BILLS", type: "user" },
    ])
    const error = await toolError(h.label.run({ ...base, add_labels: ["bills"] }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Label_7")
    expect(error.message).toContain("Label_8")
    expect(h.writes()).toEqual([])
  })

  test("TRASH, SPAM, DRAFT, SENT and CHAT are refused, each saying why, and nothing is written", async () => {
    for (const [id, why] of [
      ["TRASH", "google_gmail_trash"],
      ["SPAM", "spam is not changed by labels"],
      ["DRAFT", "drafts are not changed by labels"],
      ["SENT", "sent mail is not changed by labels"],
      ["CHAT", "chats are not changed by labels"],
    ] as const) {
      for (const field of ["add_labels", "remove_labels"]) {
        const h = await open()
        const error = await toolError(h.label.run({ ...base, [field]: ["INBOX", id] }))
        expect([id, error.code]).toEqual([id, "invalid_argument"])
        expect(error.message).toContain(why)
        expect(h.writes()).toEqual([])
      }
    }
  })

  test("an unknown name is refused listing up to 20 user labels and pointing to google_gmail_label_create", async () => {
    const own = Array.from({ length: 25 }, (_, index) => ({ id: `Label_${index}`, name: `Own ${index}`, type: "user" }))
    const h = await open([...MAILBOX_LABELS.filter((label) => label.type === "system"), ...own])
    const error = await toolError(h.label.run({ ...base, add_labels: ["Nope"] }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"Own 0"')
    expect(error.message).toContain('"Own 19"')
    expect(error.message).not.toContain('"Own 20"')
    expect(error.message).toContain("and 5 more")
    expect(error.message).toContain("google_gmail_label_create")
    expect(h.writes()).toEqual([])
  })

  test("a mailbox with no labels of its own says so", async () => {
    const h = await open([])
    expect((await toolError(h.label.run({ ...base, add_labels: ["Nope"] }))).message).toContain("no labels of its own")
  })

  test("a system label's name is not found as a user label: only user labels match by name", async () => {
    const h = await open()
    expect((await toolError(h.label.run({ ...base, add_labels: ["inbox"] }))).code).toBe("invalid_argument")
  })

  test("the labels are read once for the whole plan, and a label named twice (by name and by id) is used once", async () => {
    const h = await open()
    await h.label.run({ ...base, add_labels: ["Receipts", "Label_1"], remove_labels: ["INBOX", "INBOX"] })
    expect(h.calls().filter((request) => request.method === "GET")).toHaveLength(1)
    expect(h.writes()[0]!.json).toMatchObject({ addLabelIds: ["Label_1"], removeLabelIds: ["INBOX"] })
  })

  test("a label in both lists, by name in one and by id in the other, is refused", async () => {
    const h = await open()
    const error = await toolError(h.label.run({ ...base, add_labels: ["Receipts"], remove_labels: ["Label_1"] }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("both")
    expect(h.writes()).toEqual([])
  })
})
