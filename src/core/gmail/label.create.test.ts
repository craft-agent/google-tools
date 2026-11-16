import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import { annotations } from "../tool"
import { googleGmailLabelCreate } from "./label-create"
import { LABEL_PALETTE } from "./label-colors"
import { GMAIL_CREDENTIAL, LABELS_URL } from "./read.testing"
import { callOf, cleanUp, freshTokens, labelsHandler, mailboxFixture, postHandler } from "./mailbox.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const created = postHandler(LABELS_URL, { id: "Label_9", name: "Projects/2026", type: "user" })
const handlers = [labelsHandler(), created]

describe("google_gmail_label_create class and words", () => {
  test("add: each call makes a new label, and it removes nothing", () => {
    expect(googleGmailLabelCreate).toMatchObject({ id: "google_gmail_label_create", toolset: "gmail", class: "add" })
    expect(annotations(googleGmailLabelCreate)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    })
  })

  test("says what a name may be, that colors are from a fixed palette and what it returns", () => {
    const { description } = googleGmailLabelCreate
    expect(description).toContain("1 to 225 characters")
    expect(description).toContain("`/` nests it")
    expect(description).toContain("fixed palette")
    expect(description).toContain("`label_id`")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleGmailLabelCreate.title]).toBeDefined()
    expect(ja[googleGmailLabelCreate.intent!]).toBeDefined()
    expect(ja["About to create the label {name}"]).toBe("ラベル {name} を作成しようとしています")
    expect(ja.Colors).toBeDefined()
    expect(ja["{text} text on {background}"]).toBeDefined()
  })

  test("the palette holds only distinct #rrggbb colors", () => {
    expect(LABEL_PALETTE.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
    expect(new Set(LABEL_PALETTE).size).toBe(LABEL_PALETTE.length)
    expect(LABEL_PALETTE).toContain("#fb4c2f")
  })
})

describe("google_gmail_label_create request", () => {
  test("reads the labels, then creates the label, and returns its id and name", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.create.run({ name: "Projects/2026" })).toEqual({ label_id: "Label_9", name: "Projects/2026" })
    expect(h.calls().map(callOf)).toEqual([`GET ${LABELS_URL}`, `POST ${LABELS_URL}`])
    expect(h.writes()[0]!.json).toEqual({ name: "Projects/2026" })
  })

  test("sends the colors in lower case and the visibilities as Gmail names them", async () => {
    const h = await mailboxFixture({ handlers })
    await h.create.run({
      name: "Projects",
      text_color: "#000000",
      background_color: "#FB4C2F",
      show_in_list: false,
      show_in_messages: true,
    })
    expect(h.writes()[0]!.json).toEqual({
      name: "Projects",
      color: { textColor: "#000000", backgroundColor: "#fb4c2f" },
      labelListVisibility: "labelHide",
      messageListVisibility: "show",
    })
    const shown = await mailboxFixture({ handlers })
    await shown.create.run({ name: "Projects", show_in_list: true, show_in_messages: false })
    expect(shown.writes()[0]!.json).toEqual({
      name: "Projects",
      labelListVisibility: "labelShow",
      messageListVisibility: "hide",
    })
  })

  test("a name already used, ignoring case, is refused before writing, a system label's name included", async () => {
    for (const name of ["Receipts", "RECEIPTS", "work/invoices", "Inbox"]) {
      const h = await mailboxFixture({ handlers })
      const error = await toolError(h.create.run({ name }))
      expect([name, error.code]).toEqual([name, "invalid_argument"])
      expect(error.message).toContain("already exists")
      expect(h.writes()).toEqual([])
    }
  })

  test("a color outside the palette is refused with the palette, and only one color is refused too", async () => {
    const h = await mailboxFixture({ handlers })
    const error = await toolError(h.create.run({ name: "X", text_color: "#000000", background_color: "#123456" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`background_color`")
    expect(error.message).toContain("Colors must be from Gmail's palette")
    expect(error.message).toContain(LABEL_PALETTE.join(", "))
    const text = await toolError(h.create.run({ name: "X", text_color: "red", background_color: "#000000" }))
    expect(text.message).toContain("`text_color`")
    expect((await toolError(h.create.run({ name: "X", text_color: "#000000" }))).message).toContain("both")
    expect((await toolError(h.create.run({ name: "X", background_color: "#000000" }))).message).toContain("both")
    expect(h.calls()).toEqual([])
  })

  test.each([
    ["an empty name", { name: "" }],
    ["a name with a space at its start", { name: " Work" }],
    ["a name with a space at its end", { name: "Work " }],
    ["a name of 226 characters", { name: "x".repeat(226) }],
    ["a visibility that is not a boolean", { name: "Work", show_in_list: "yes" }],
    ["an unknown argument", { name: "Work", extra: 1 }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await mailboxFixture({ handlers })
    expect((await toolError(h.create.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("a name of 225 characters and one that nests are accepted", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.create.run({ name: `${"x".repeat(220)}/a/b` })).toMatchObject({ label_id: "Label_9" })
  })

  test("a label without gmail.modify fails before any request", async () => {
    const h = await mailboxFixture({ handlers, credential: GMAIL_CREDENTIAL })
    const error = await toolError(h.create.run({ name: "Work" }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("gmail.modify")
    expect(h.calls()).toEqual([])
  })
})

describe("google_gmail_label_create describe and targets", () => {
  test("headlines the name and shows the colors, and describes no colors when there are none", async () => {
    const h = await mailboxFixture({ handlers })
    const colored = await h.create.describe({ name: "Work", text_color: "#000000", background_color: "#16A766" })
    expect(colored.headline).toEqual({ text: "About to create the label {name}", values: { name: "Work" } })
    expect(colored.facts).toEqual([
      {
        label: "Colors",
        value: { text: "{text} text on {background}", values: { text: "#000000", background: "#16a766" } },
      },
    ])
    expect(colored.pins).toBeUndefined()
    expect((await h.create.describe({ name: "Work" })).facts).toEqual([])
  })

  test("describe throws where execute would", async () => {
    const h = await mailboxFixture({ handlers })
    expect((await toolError(h.create.describe({ name: "receipts" }))).code).toBe("invalid_argument")
  })

  test("its one target is `<label>/labels/new`, and `*` when the account cannot be told", async () => {
    const h = await mailboxFixture({ handlers })
    expect(await h.create.targets({ name: "Work" })).toEqual(["work/labels/new"])
    expect(await (await mailboxFixture({ credential: null })).create.targets({ name: "Work" })).toEqual(["*"])
  })

  test("declares no bounds: a label is one thing to create", () => {
    expect(googleGmailLabelCreate.bounds).toBeUndefined()
    expect(googleGmailLabelCreate.measure).toBeUndefined()
  })
})
