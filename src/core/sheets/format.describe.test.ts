import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { annotations } from "../tool"
import { isAbortError } from "../errors"
import { toolError } from "../google/client.fixtures"
import { writeTargets } from "../targets"
import { googleSheetsFormat } from "./format"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { BATCH_UPDATE_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}/sheets`

const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

const handlers = () => [metadata(), post(BATCH_UPDATE_URL)]

describe("google_sheets_format: class and bounds", () => {
  test("is an idempotent change: not read-only, not destructive, idempotent", () => {
    expect(googleSheetsFormat).toMatchObject({ toolset: "sheets", class: "idempotent" })
    expect(annotations(googleSheetsFormat)).toEqual({
      title: "Format a Google spreadsheet",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
  })

  test("says what it never does, and that every operation lands or none", () => {
    expect(googleSheetsFormat.description).toContain("all of them land or none does")
    expect(googleSheetsFormat.description).toContain("never changes a cell's value and never removes anything")
  })

  test("bounds the operations and the ranges, measured from the arguments", () => {
    expect(Object.keys(googleSheetsFormat.bounds!)).toEqual(["operations", "ranges"])
    const args = googleSheetsFormat.input.parse(call({ op: "hide", ranges: ["A:A", "C:C"] }, { op: "freeze", rows: 1 }))

    expect(googleSheetsFormat.measure!(args, { cwd: "/" })).toEqual({ operations: 2, ranges: 2 })
  })
})

describe("google_sheets_format: targets", () => {
  test("names each distinct tab once, sorted, the first tab for what names none", async () => {
    const h = await writeFixture(handlers())

    const targets = await writeTargets(
      googleSheetsFormat,
      call(
        { op: "format", range: "'My Tab'!A1", bold: true },
        { op: "hide", ranges: ["Plan!B:B", "'a/b'!C:C", "my tab!D:D"] },
        { op: "freeze", rows: 1 },
        { op: "tab", tab: "a/b", hidden: false },
      ),
      h.ctx,
    )

    expect(targets).toEqual([`${BASE}/0`, `${BASE}/5`, `${BASE}/77`])
  })

  test.each([
    ["a tab the spreadsheet lacks", call({ op: "format", range: "Nope!A1", bold: true })],
    ["a block where whole rows are needed", call({ op: "size", range: "A1:B2", auto: true })],
    ["an operation outside the vocabulary", call({ op: "delete", range: "A:A" })],
    ["a spreadsheet that is none", { ...call({ op: "freeze", rows: 1 }), spreadsheet: "not a spreadsheet" }],
  ])("are `*` for %s", async (_name, args) => {
    const h = await writeFixture(handlers())

    expect(await writeTargets(googleSheetsFormat, args, h.ctx)).toEqual(["*"])
  })

  test("are `*` when Google fails, when there is no label, and for a label that cannot write, before any request", async () => {
    const down = await writeFixture([
      {
        method: "GET",
        url: SPREADSHEET_URL,
        reply: { status: 500, json: { error: { code: 500, message: "Down", status: "INTERNAL" } } },
      },
    ])
    const none = await writeFixture(handlers(), null)
    const readOnly = await writeFixture(handlers(), SHEETS_CREDENTIAL)
    const args = call({ op: "freeze", rows: 1 })

    expect(await writeTargets(googleSheetsFormat, args, down.ctx)).toEqual(["*"])
    expect(await writeTargets(googleSheetsFormat, args, none.ctx)).toEqual(["*"])
    expect(await writeTargets(googleSheetsFormat, args, readOnly.ctx)).toEqual(["*"])
    expect(readOnly.requests).toEqual([])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const h = await writeFixture(handlers())
    const controller = new AbortController()
    controller.abort()

    const error = await writeTargets(googleSheetsFormat, call({ op: "freeze", rows: 1 }), {
      ...h.ctx,
      signal: controller.signal,
    }).catch((caught) => caught)

    expect(isAbortError(error)).toBe(true)
  })
})

describe("google_sheets_format: describe", () => {
  const describeCall = async (args: unknown, h: Awaited<ReturnType<typeof writeFixture>>) =>
    googleSheetsFormat.describe!(googleSheetsFormat.input.parse(args), h.ctx)

  test("names the tab and the spreadsheet by Google's titles when one tab changes, with the operations as lines", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(
      call(
        { op: "format", range: "plan!A1:F1", bold: true, background: "#FFEEAA" },
        { op: "freeze", tab: "PLAN", rows: 1 },
        { op: "size", range: "Plan!B:C", pixels: 120 },
      ),
      h,
    )

    expect(description).toEqual({
      headline: { text: "About to format {tab} in {spreadsheet}", values: { tab: "Plan", spreadsheet: "Budget 2027" } },
      facts: [
        { label: "Tabs", value: "Plan" },
        { label: "Operations", value: { text: "{count} operations", values: { count: 3 } } },
        { label: "Ranges", value: { text: "{count} ranges", values: { count: 2 } } },
      ],
      text: {
        label: "Operations",
        body: "format Plan!A1:F1 bold, background #ffeeaa\nfreeze Plan rows 1\nsize Plan!B:C 120px",
      },
    })
    expect(writesOf(h.requests)).toEqual([])
  })

  test("names the spreadsheet alone for several tabs, listing their titles in the order of the tabs", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(
      call(
        { op: "hide", range: "'a/b'!2:3" },
        { op: "unmerge", range: "Plan!A1:B2" },
        { op: "tab", tab: "My Tab", position: 0 },
      ),
      h,
    )

    expect(description.headline).toEqual({
      text: "About to format {spreadsheet}",
      values: { spreadsheet: "Budget 2027" },
    })
    expect(description.facts[0]).toEqual({ label: "Tabs", value: "Plan, My Tab, a/b" })
    expect(description.facts.slice(1)).toEqual([
      { label: "Operations", value: { text: "{count} operations", values: { count: 3 } } },
      { label: "Ranges", value: { text: "{count} ranges", values: { count: 2 } } },
    ])
    expect(description.text!.body.split("\n")).toEqual([
      "hide 'a/b'!2:3",
      "unmerge Plan!A1:B2",
      "tab 'My Tab' position 0",
    ])
  })

  test("counts one operation and one range in the singular, and carries no pin", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(call({ op: "unmerge", range: "Plan!A1" }), h)

    expect(description.facts.slice(1)).toEqual([
      { label: "Operations", value: { text: "{count} operation", values: { count: 1 } } },
      { label: "Ranges", value: { text: "{count} range", values: { count: 1 } } },
    ])
    expect(description.pins).toBeUndefined()
  })

  test("renders every operation as one fixed line, quoting the values the call gives", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(
      call(
        {
          op: "format",
          range: "A1",
          reset: true,
          italic: false,
          font: 'Ro"boto',
          color: null,
          number_format: { type: "date", pattern: "yyyy" },
        },
        { op: "borders", range: "Plan!A1:C3", sides: ["top", "bottom"], style: "dotted", color: "#0F0" },
        { op: "borders", range: "Plan!A1:C3", sides: "none" },
        { op: "size", range: "Plan!3:5", auto: true },
        { op: "hide", range: "Plan!B:B" },
        { op: "unhide", range: "Plan!B:B" },
        { op: "group", range: "Plan!2:5", collapsed: true },
        { op: "ungroup", range: "Plan!2:5" },
        { op: "freeze", rows: 1, columns: 2 },
        { op: "tab", tab: "Plan", color: null, hidden: true, gridlines: false },
      ),
      h,
    )

    expect(description.text!.body.split("\n")).toEqual([
      'format Plan!A1 reset, no italic, font "Ro\\"boto", no color, number date "yyyy"',
      "borders Plan!A1:C3 top+bottom dotted #00ff00",
      "borders Plan!A1:C3 none",
      "size Plan!3:5 auto",
      "hide Plan!B:B",
      "unhide Plan!B:B",
      "group Plan!2:5 collapsed",
      "ungroup Plan!2:5",
      "freeze Plan rows 1, columns 2",
      "tab Plan no color, hidden, no gridlines",
    ])
  })

  test("shows the first four ranges of an operation and counts the rest", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(call({ op: "hide", ranges: ["A:A", "B:B", "C:C", "D:D", "E:E", "F:F"] }), h)

    expect(description.text!.body).toBe("hide Plan!A:A, Plan!B:B, Plan!C:C, Plan!D:D +2")
  })

  test("throws where the call would be refused, so the call fails with its own message", async () => {
    const h = await writeFixture(handlers())

    const error = await toolError(describeCall(call({ op: "hide", range: "Plan!A1:B2" }), h))

    expect(error.code).toBe("invalid_argument")
  })
})
