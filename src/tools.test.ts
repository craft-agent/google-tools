import { describe, expect, test } from "bun:test"
import { annotations } from "./core"
import { PROJECT } from "./project"
import { ALL_TOOLS } from "./tools"

describe("the registry", () => {
  test("every tool id is unique", () => {
    const ids = ALL_TOOLS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every tool id starts with the package's tool prefix", () => {
    const stray = ALL_TOOLS.filter((spec) => !spec.id.startsWith(`${PROJECT.toolPrefix}_`)).map((spec) => spec.id)
    expect(stray).toEqual([])
  })

  test("every tool belongs to a toolset the package defines", () => {
    const stray = ALL_TOOLS.filter((spec) => !PROJECT.toolsets.includes(spec.toolset)).map((spec) => spec.id)
    expect(stray).toEqual([])
  })
})

describe("the account read", () => {
  test("is a read tool of the account toolset, which is on by default", () => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === "google_account_read")
    expect(spec).toMatchObject({ toolset: "account", class: "read" })
    expect(PROJECT.defaultToolsets).toContain("account")
  })
})

describe("the Sheets read", () => {
  test("is a read tool of the sheets toolset, which is on by default", () => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === "google_sheets_read")
    expect(spec).toMatchObject({ toolset: "sheets", class: "read" })
    expect(PROJECT.defaultToolsets).toContain("sheets")
  })
})

describe("the Gmail read", () => {
  test("is a read tool of the gmail toolset, which is on by default", () => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === "google_gmail_read")
    expect(spec).toMatchObject({ toolset: "gmail", class: "read" })
    expect(PROJECT.defaultToolsets).toContain("gmail")
    expect(annotations(spec!)).toMatchObject({ readOnlyHint: true, openWorldHint: true })
  })
})

describe("the Gmail writes", () => {
  const WRITES = [
    ["google_gmail_send", "administrative", true],
    ["google_gmail_draft_create", "add", false],
    ["google_gmail_draft_edit", "overwrite", true],
    ["google_gmail_draft_delete", "administrative", true],
    ["google_gmail_label", "idempotent", false],
    ["google_gmail_label_create", "add", false],
    ["google_gmail_trash", "overwrite", true],
  ] as const

  /** The tools that declare no bounds: a draft delete and a label creation are one object each. */
  const UNBOUNDED = ["google_gmail_draft_delete", "google_gmail_label_create"]

  test.each(WRITES)(
    "%s is a %s tool of the gmail toolset with the destructive hint %p",
    (id, writeClass, destructive) => {
      const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
      expect(spec).toMatchObject({ toolset: "gmail", class: writeClass })
      expect(annotations(spec)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: destructive,
        openWorldHint: true,
      })
    },
  )

  test.each(WRITES)("%s states its intent, describes its call and resolves its targets", (id) => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
    expect(spec.intent).toStartWith("About to ")
    expect(spec.describe).toBeDefined()
    expect(spec.targets).toBeDefined()
  })

  test.each(WRITES.filter(([id]) => !UNBOUNDED.includes(id)))("%s declares bounds and measures them", (id) => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
    expect(Object.keys(spec.bounds ?? {})).not.toEqual([])
    expect(spec.measure).toBeDefined()
  })

  test("only the trash is destructive among the label tools", () => {
    const destructive = ["google_gmail_label", "google_gmail_label_create", "google_gmail_trash"].filter(
      (id) => annotations(ALL_TOOLS.find((candidate) => candidate.id === id)!).destructiveHint,
    )
    expect(destructive).toEqual(["google_gmail_trash"])
  })
})

describe("the Sheets writes", () => {
  const WRITES = [
    ["google_sheets_append", "add", false],
    ["google_sheets_edit", "overwrite", true],
    ["google_sheets_clear", "overwrite", true],
    ["google_sheets_create", "add", false],
    ["google_sheets_tab_add", "add", false],
    ["google_sheets_format", "idempotent", false],
    ["google_sheets_add", "add", false],
    ["google_sheets_restructure", "administrative", true],
    ["google_sheets_transform", "administrative", true],
    ["google_sheets_protect", "administrative", true],
  ] as const

  test.each(WRITES)(
    "%s is a %s tool of the sheets toolset with the destructive hint %p",
    (id, writeClass, destructive) => {
      const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
      expect(spec).toMatchObject({ toolset: "sheets", class: writeClass })
      expect(annotations(spec)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: destructive,
        openWorldHint: true,
      })
    },
  )

  test.each(WRITES)("%s states its intent, describes its call, resolves its targets and declares bounds", (id) => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
    expect(spec.intent).toStartWith("About to ")
    expect(spec.describe).toBeDefined()
    expect(spec.targets).toBeDefined()
    expect(spec.bounds).toBeDefined()
  })

  test.each(WRITES.filter(([id]) => id !== "google_sheets_tab_add"))("%s declares bounds and measures them", (id) => {
    const spec = ALL_TOOLS.find((candidate) => candidate.id === id)!
    expect(Object.keys(spec.bounds ?? {})).not.toEqual([])
    expect(spec.measure).toBeDefined()
  })

  test("the bounds are measured from the arguments alone", () => {
    const find = (id: string) => ALL_TOOLS.find((candidate) => candidate.id === id)!
    const values = [[1, 2], [3]]
    const parsed = (spec: (typeof ALL_TOOLS)[number], args: unknown) => spec.input.parse(args)
    const spreadsheet = "1MadeUpSpreadsheetId_abcdefghij"

    const append = find("google_sheets_append")
    const edit = find("google_sheets_edit")
    const clear = find("google_sheets_clear")
    expect(append.measure!(parsed(append, { spreadsheet, range: "A1", values }), { cwd: "/" })).toEqual({
      rows: 2,
      cells: 3,
    })
    expect(
      edit.measure!(
        parsed(edit, {
          spreadsheet,
          data: [
            { range: "A1", values },
            { range: "B1", values: [[1]] },
          ],
        }),
        { cwd: "/" },
      ),
    ).toEqual({ cells: 4, ranges: 2 })
    expect(clear.measure!(parsed(clear, { spreadsheet, ranges: ["A1", "B1", "C1"] }), { cwd: "/" })).toEqual({
      ranges: 3,
    })
    const create = find("google_sheets_create")
    expect(create.measure!(parsed(create, { title: "T", tabs: ["a", "b"] }), { cwd: "/" })).toEqual({ tabs: 2 })
    expect(create.measure!(parsed(create, { title: "T" }), { cwd: "/" })).toEqual({ tabs: 0 })
    const format = find("google_sheets_format")
    const operations = [
      { op: "hide", ranges: ["A:A", "C:C"] },
      { op: "unmerge", range: "A1:B2" },
      { op: "freeze", rows: 1 },
    ]
    expect(format.measure!(parsed(format, { spreadsheet, operations }), { cwd: "/" })).toEqual({
      operations: 3,
      ranges: 3,
    })
    const add = find("google_sheets_add")
    const additions = [
      { op: "insert", range: "Plan!3:4" },
      { op: "tab_duplicate", tab: "Plan" },
    ]
    expect(add.measure!(parsed(add, { spreadsheet, operations: additions }), { cwd: "/" })).toEqual({
      operations: 2,
      ranges: 1,
    })
    const restructure = find("google_sheets_restructure")
    const changes = [
      { op: "delete", ranges: ["Plan!3:4", "Plan!8:8"] },
      { op: "tab_rename", tab: "Plan", title: "New" },
    ]
    const measureOf = (operations: unknown[]) =>
      restructure.measure!(parsed(restructure, { spreadsheet, operations }), { cwd: "/" })
    expect(measureOf(changes)).toEqual({ operations: 2, ranges: 2, deletes_tabs: false })
    expect(measureOf([{ op: "tab_delete", tab: "Plan" }])).toEqual({ operations: 1, ranges: 0, deletes_tabs: true })
    const protect = find("google_sheets_protect")
    const protections = [
      { op: "protect", range: "Plan", editors: ["a@example.test", "b@example.test", "a@example.test"] },
      { op: "protect_delete", protection: 7 },
    ]
    expect(protect.measure!(parsed(protect, { spreadsheet, operations: protections }), { cwd: "/" })).toEqual({
      operations: 2,
      editors: 2,
    })
  })
})

describe("the package's toolsets", () => {
  test("none is listed twice", () => {
    expect(new Set(PROJECT.toolsets).size).toBe(PROJECT.toolsets.length)
  })

  test("the default toolsets are among them", () => {
    const stray = PROJECT.defaultToolsets.filter((name) => !PROJECT.toolsets.includes(name))
    expect(stray).toEqual([])
  })
})
