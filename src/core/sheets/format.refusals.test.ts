import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { sheetsFormatInput } from "./format"
import { FORMAT_OPERATIONS } from "./format-operations"
import { BATCH_UPDATE_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const call = (operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

/** The message the arguments are refused with, or `undefined` when they are accepted. */
function refusal(operations: unknown[]): string | undefined {
  const parsed = sheetsFormatInput.safeParse(call(operations))
  return parsed.success ? undefined : parsed.error.issues.map((issue) => issue.message).join("; ")
}

describe("google_sheets_format: the vocabulary", () => {
  test("refuses an operation outside it, naming the operation and the ones offered", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    const error = await toolError(h.format(call([{ op: "delete", range: "Plan!2:3" }])))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Unknown operation "delete"')
    expect(error.message).toContain("format, borders, size, hide, unhide, group, ungroup, unmerge, freeze, tab")
    expect(h.requests).toEqual([])
  })

  test("names each operation's schema by the key it is offered under, and tells them apart by `op`", () => {
    for (const [name, spec] of Object.entries(FORMAT_OPERATIONS)) {
      expect([name, spec.schema.shape.op.value]).toEqual([name, name])
    }
  })

  test.each([[{ range: "Plan!A1" }], [{ op: 7 }]])("refuses %p as no operation", (item) => {
    expect(refusal([item])).toContain("the operations are: format, borders")
  })

  test("refuses an argument an operation does not take, a renaming title included", () => {
    expect(sheetsFormatInput.safeParse(call([{ op: "tab", tab: "Plan", title: "New", hidden: true }])).success).toBe(
      false,
    )
    expect(sheetsFormatInput.safeParse(call([{ op: "hide", range: "A:A", pixels: 3 }])).success).toBe(false)
    expect(sheetsFormatInput.safeParse({ ...call([{ op: "hide", range: "A:A" }]), extra: 1 }).success).toBe(false)
  })

  test.each([
    ["a format with no property", { op: "format", range: "A1" }, "at least one property"],
    ["a format that resets nothing", { op: "format", range: "A1", reset: false }, "at least one property"],
    ["no range", { op: "format", bold: true }, "`range` or `ranges`"],
    ["both range and ranges", { op: "unmerge", range: "A1", ranges: ["B2"] }, "`range` or `ranges`"],
    ["a tab with nothing to change", { op: "tab", tab: "Plan" }, "never renames"],
    ["a freeze with nothing to freeze", { op: "freeze" }, "`rows` or `columns`"],
    ["a size with neither pixels nor auto", { op: "size", range: "A:A" }, "`pixels` or `auto: true`"],
    ["a size with both", { op: "size", range: "A:A", pixels: 10, auto: true }, "`pixels` or `auto: true`"],
    ["borders none with a style", { op: "borders", range: "A1", sides: "none", style: "dotted" }, "`none`"],
    ["borders none among sides", { op: "borders", range: "A1", sides: ["top", "none"] }, "`none`"],
    ["an empty padding", { op: "format", range: "A1", padding: {} }, "at least one side"],
  ])("refuses %s", (_name, operation, message) => {
    expect(refusal([operation])).toContain(message)
  })

  test.each([
    ["a font size of 0", { font_size: 0 }],
    ["a font size over 400", { font_size: 401 }],
    ["a color that is not hex", { color: "red" }],
    ["a background of 5 digits", { background: "#12345" }],
    ["an unknown theme color", { color: "theme:NOPE" }],
    ["a rotation over 90", { rotation: 91 }],
    ["a rotation word", { rotation: "sideways" }],
    ["an unknown alignment", { horizontal_align: "justify" }],
    ["an unknown wrap", { wrap: "none" }],
    ["an unknown number type", { number_format: { type: "automatic" } }],
    ["a padding over 100", { padding: { top: 101 } }],
    ["a padding side that is not one", { padding: { middle: 1 } }],
  ])("refuses %s", (_name, extra) => {
    expect(sheetsFormatInput.safeParse(call([{ op: "format", range: "A1", ...extra }])).success).toBe(false)
  })

  test("takes a theme color and a short hex color", () => {
    expect(refusal([{ op: "format", range: "A1", color: "theme:accent1", background: "#abc" }])).toBeUndefined()
  })
})

describe("google_sheets_format: the limits", () => {
  const hide = (count: number) => ({ op: "hide", ranges: Array.from({ length: count }, (_, i) => `Plan!${i + 1}`) })

  test("takes 1 to 100 operations", () => {
    const freeze = { op: "freeze", rows: 1 }
    expect(refusal([])).toBeDefined()
    expect(refusal(Array.from({ length: 100 }, () => freeze))).toBeUndefined()
    expect(refusal(Array.from({ length: 101 }, () => freeze))).toBeDefined()
  })

  test("takes at most 500 ranges in all, counted across the operations", () => {
    expect(refusal([hide(250), hide(250)])).toBeUndefined()
    expect(refusal([hide(250), hide(251)])).toContain("more than 500 ranges")
    expect(refusal([hide(501)])).toBeDefined()
  })

  test("a freeze or a tab names no range", () => {
    expect(refusal([hide(500), { op: "freeze", rows: 1 }, { op: "tab", tab: "Plan", hidden: true }])).toBeUndefined()
  })
})

describe("google_sheets_format: what it plans before it writes", () => {
  const handlers = () => [metadata(), post(BATCH_UPDATE_URL)]

  test.each([
    ["a block where whole rows are needed", { op: "size", range: "Plan!A1:C3", pixels: 50 }, "whole rows"],
    ["a whole tab where whole columns are needed", { op: "hide", range: "Plan" }, "whole rows"],
    ["a tab the spreadsheet lacks", { op: "format", range: "Nope!A1", bold: true }, "Plan, My Tab, a/b"],
    ["a range that is not A1 notation", { op: "format", range: "Plan!A1:", bold: true }, "not in A1 notation"],
    ["a tab to freeze that is not there", { op: "freeze", tab: "Nope", rows: 1 }, "Plan, My Tab, a/b"],
  ])("refuses %s as invalid_argument and writes nothing", async (_name, operation, message) => {
    const h = await writeFixture(handlers())

    const error = await toolError(h.format(call([{ op: "format", range: "Plan!A1", bold: true }, operation])))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(writesOf(h.requests)).toEqual([])
  })

  test("fails for a label that cannot write before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.format(call([{ op: "freeze", rows: 1 }])))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("passes Google's refusal of the batch on", async () => {
    const h = await writeFixture([
      metadata(),
      {
        method: "POST",
        url: BATCH_UPDATE_URL,
        reply: {
          status: 400,
          json: { error: { code: 400, message: "Invalid requests[0]", status: "INVALID_ARGUMENT" } },
        },
      },
    ])

    const error = await toolError(h.format(call([{ op: "freeze", rows: 1 }])))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Invalid requests[0]")
  })
})
