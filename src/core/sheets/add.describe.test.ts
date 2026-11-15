import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { annotations } from "../tool"
import { writeTargets } from "../targets"
import { googleSheetsAdd } from "./add"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { BATCH_UPDATE_URL, metadata, post, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}`

const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

const handlers = () => [metadata(), post(BATCH_UPDATE_URL)]

describe("google_sheets_add: class and bounds", () => {
  test("is an add: not read-only, not destructive, not idempotent", () => {
    expect(googleSheetsAdd).toMatchObject({ toolset: "sheets", class: "add" })
    expect(annotations(googleSheetsAdd)).toEqual({
      title: "Add rows and tabs to a Google spreadsheet",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  test("says that the operations apply in order and that a later range sees the shifted cells", () => {
    expect(googleSheetsAdd.description).toContain("apply in order")
    expect(googleSheetsAdd.description).toContain("a later operation's range means the cells as they stand by then")
  })

  test("bounds the operations and the ranges, measured from the arguments", () => {
    expect(Object.keys(googleSheetsAdd.bounds!)).toEqual(["operations", "ranges"])
    const args = googleSheetsAdd.input.parse(
      call({ op: "insert", range: "Plan!2:3" }, { op: "tab_duplicate", tab: "Plan" }),
    )

    expect(googleSheetsAdd.measure!(args, { cwd: "/" })).toEqual({ operations: 2, ranges: 1 })
  })

  test("takes 1 to 100 operations", () => {
    const insert = { op: "insert", range: "Plan!2:3" }
    expect(googleSheetsAdd.input.safeParse(call()).success).toBe(false)
    expect(googleSheetsAdd.input.safeParse(call(...Array.from({ length: 100 }, () => insert))).success).toBe(true)
    expect(googleSheetsAdd.input.safeParse(call(...Array.from({ length: 101 }, () => insert))).success).toBe(false)
  })
})

describe("google_sheets_add: targets", () => {
  test("names the tab an insert changes, and the spreadsheet for a new tab", async () => {
    const h = await writeFixture(handlers())

    expect(await writeTargets(googleSheetsAdd, call({ op: "insert", range: "'My Tab'!3:4" }), h.ctx)).toEqual([
      `${BASE}/sheets/77`,
    ])
    expect(await writeTargets(googleSheetsAdd, call({ op: "tab_duplicate", tab: "Plan" }), h.ctx)).toEqual([BASE])
    expect(
      await writeTargets(
        googleSheetsAdd,
        call(
          { op: "insert", range: "a/b!C:C" },
          { op: "tab_duplicate", tab: "Plan" },
          { op: "insert", range: "Plan!2:2" },
        ),
        h.ctx,
      ),
    ).toEqual([BASE, `${BASE}/sheets/0`, `${BASE}/sheets/5`])
  })

  test.each([
    ["a tab the spreadsheet lacks", call({ op: "insert", range: "Nope!3:4" })],
    ["a block where whole rows are needed", call({ op: "insert", range: "A1:B2" })],
    ["an operation outside the vocabulary", call({ op: "merge", range: "A1:B2" })],
  ])("are `*` for %s", async (_name, args) => {
    const h = await writeFixture(handlers())

    expect(await writeTargets(googleSheetsAdd, args, h.ctx)).toEqual(["*"])
  })

  test("are `*` for a label that cannot write, before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    expect(await writeTargets(googleSheetsAdd, call({ op: "insert", range: "Plan!2:2" }), h.ctx)).toEqual(["*"])
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_add: describe", () => {
  const describeCall = async (args: unknown, h: Awaited<ReturnType<typeof writeFixture>>) =>
    googleSheetsAdd.describe!(googleSheetsAdd.input.parse(args), h.ctx)

  test("names the tab and the spreadsheet when one tab changes, with the operations as lines", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(
      call({ op: "insert", range: "plan!5:7", inherit: "after" }, { op: "insert", range: "Plan!C:C" }),
      h,
    )

    expect(description).toEqual({
      headline: { text: "About to add to {tab} in {spreadsheet}", values: { tab: "Plan", spreadsheet: "Budget 2027" } },
      facts: [
        { label: "Tabs", value: "Plan" },
        { label: "Operations", value: { text: "{count} operations", values: { count: 2 } } },
        { label: "Ranges", value: { text: "{count} ranges", values: { count: 2 } } },
      ],
      text: {
        label: "Operations",
        body: "insert 3 rows before Plan!5:7, formatted like the row after\ninsert 1 column before Plan!C:C, formatted like the column before",
      },
    })
  })

  test("names the spreadsheet alone when a tab is copied or several tabs change, and says `none` for no tab", async () => {
    const h = await writeFixture(handlers())

    const copy = await describeCall(call({ op: "tab_duplicate", tab: "Plan", title: "Plan 2", position: 1 }), h)
    const several = await describeCall(call({ op: "insert", range: "Plan!2:2" }, { op: "insert", range: "a/b!2:2" }), h)
    const mixed = await describeCall(call({ op: "insert", range: "Plan!2:2" }, { op: "tab_duplicate", tab: "Plan" }), h)

    expect(copy.headline).toEqual({ text: "About to add to {spreadsheet}", values: { spreadsheet: "Budget 2027" } })
    expect(copy.facts[0]).toEqual({ label: "Tabs", value: { text: "none" } })
    expect(copy.text!.body).toBe('tab_duplicate Plan as "Plan 2" at position 1')
    expect(several.facts[0]).toEqual({ label: "Tabs", value: "Plan, a/b" })
    expect(several.headline!.text).toBe("About to add to {spreadsheet}")
    expect(mixed.headline!.text).toBe("About to add to {spreadsheet}")
    expect(mixed.facts[0]).toEqual({ label: "Tabs", value: "Plan" })
  })

  test("throws where the call would refuse, and sends no write", async () => {
    const h = await writeFixture(handlers())

    const error = await toolError(Promise.resolve(describeCall(call({ op: "insert", range: "Plan!1:1" }), h)))

    expect(error.code).toBe("invalid_argument")
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`])
  })
})

describe("google_sheets_add: a label that cannot write", () => {
  test("fails before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.add(call({ op: "insert", range: "Plan!2:2" })))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})
