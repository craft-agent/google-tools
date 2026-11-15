import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { isAbortError } from "../errors"
import { toolError } from "../google/client.fixtures"
import { PIN_PATTERN } from "../pin"
import { writeTargets } from "../targets"
import { annotations } from "../tool"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { BATCH_UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}`

const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

const handlers = (rows: (range: string) => unknown[][] | undefined = () => []) => [
  metadata(),
  valuesHandler(rows),
  post(BATCH_UPDATE_URL),
]

type Fixture = Awaited<ReturnType<typeof writeFixture>>

const describeCall = (args: unknown, h: Fixture) =>
  googleSheetsRestructure.describe!(googleSheetsRestructure.input.parse(args), h.ctx)

describe("google_sheets_restructure: class and bounds", () => {
  test("administrative: destructive and not idempotent, since deleting twice deletes more", () => {
    expect(googleSheetsRestructure).toMatchObject({ toolset: "sheets", class: "administrative" })
    expect(annotations(googleSheetsRestructure)).toEqual({
      title: "Restructure a Google spreadsheet",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  test("bounds the operations, the ranges and the deleting of tabs, measured from the arguments", () => {
    expect(googleSheetsRestructure.bounds).toMatchObject({
      operations: { kind: "max" },
      ranges: { kind: "max" },
      deletes_tabs: { kind: "allow" },
    })
    const measure = (...operations: unknown[]) =>
      googleSheetsRestructure.measure!(googleSheetsRestructure.input.parse(call(...operations)), { cwd: "/" })

    expect(
      measure({ op: "delete", ranges: ["Plan!2:3", "Plan!8:8"] }, { op: "tab_rename", tab: "Plan", title: "X" }),
    ).toEqual({
      operations: 2,
      ranges: 2,
      deletes_tabs: false,
    })
    expect(measure({ op: "tab_delete", tab: "Plan" })).toEqual({ operations: 1, ranges: 0, deletes_tabs: true })
  })

  test("says what its result holds and does not hold", () => {
    expect(googleSheetsRestructure.description).toContain("`before` holds the values the call removes or replaces")
    expect(googleSheetsRestructure.description).toContain("is not restored from it")
  })
})

describe("google_sheets_restructure: targets", () => {
  test("names each tab a call changes, and the spreadsheet for its title and settings, sorted", async () => {
    const h = await writeFixture(handlers())

    expect(
      await writeTargets(
        googleSheetsRestructure,
        call(
          { op: "delete", range: "'My Tab'!2:3" },
          { op: "tab_rename", tab: "a/b", title: "New" },
          { op: "merge", range: "A1:B2" },
        ),
        h.ctx,
      ),
    ).toEqual([`${BASE}/sheets/0`, `${BASE}/sheets/5`, `${BASE}/sheets/77`])
    expect(
      await writeTargets(googleSheetsRestructure, call({ op: "spreadsheet_rename", title: "New" }), h.ctx),
    ).toEqual([BASE])
    expect(
      await writeTargets(
        googleSheetsRestructure,
        call({ op: "spreadsheet_settings", time_zone: "Asia/Tokyo" }, { op: "tab_delete", tab: "Plan" }),
        h.ctx,
      ),
    ).toEqual([BASE, `${BASE}/sheets/0`])
  })

  test.each([
    ["a tab the spreadsheet lacks", call({ op: "delete", range: "Nope!3:4" })],
    [
      "a delete followed by an operation on its tab",
      call({ op: "delete", range: "Plan!3:4" }, { op: "merge", range: "A1:B2" }),
    ],
    [
      "the only visible tab deleted",
      call({ op: "tab_delete", tab: "Plan" }, { op: "tab_delete", tab: "a/b" }, { op: "tab_delete", tab: "My Tab" }),
    ],
    ["an operation outside the vocabulary", call({ op: "insert", range: "Plan!3:4" })],
  ])("are `*` for %s", async (_name, args) => {
    const h = await writeFixture(handlers())

    expect(await writeTargets(googleSheetsRestructure, args, h.ctx)).toEqual(["*"])
  })

  test("are `*` for a label that cannot write, before any request, and pass a cancellation on", async () => {
    const readOnly = await writeFixture(handlers(), SHEETS_CREDENTIAL)
    expect(
      await writeTargets(googleSheetsRestructure, call({ op: "delete", range: "Plan!2:2" }), readOnly.ctx),
    ).toEqual(["*"])
    expect(readOnly.requests).toEqual([])

    const h = await writeFixture(handlers())
    const controller = new AbortController()
    controller.abort()
    const error = await writeTargets(googleSheetsRestructure, call({ op: "delete", range: "Plan!2:2" }), {
      ...h.ctx,
      signal: controller.signal,
    }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
  })
})

describe("google_sheets_restructure: describe", () => {
  test("names the tab and the spreadsheet, counts the filled cells the rows lose, and pins their values", async () => {
    const h = await writeFixture(
      handlers(() => [
        ["Pens", 3, ""],
        [null, "=A1"],
      ]),
    )

    const description = await describeCall(
      { ...call({ op: "delete", ranges: ["plan!2:3", "Plan!9:9"] }), expect: [{ range: "Plan!A1", value: "Item" }] },
      h,
    )

    expect(description).toEqual({
      headline: {
        text: "About to restructure {tab} in {spreadsheet}",
        values: { tab: "Plan", spreadsheet: "Budget 2027" },
      },
      facts: [
        { label: "Overwrites", value: { text: "{count} cells", values: { count: 6 } } },
        { label: "Checks", value: { text: "{count} check", values: { count: 1 } } },
        { label: "Tabs", value: "Plan" },
        { label: "Operations", value: { text: "{count} operation", values: { count: 1 } } },
      ],
      text: { label: "Operations", body: "delete Plan!2:3, Plan!9:9" },
      pins: { values: expect.stringMatching(PIN_PATTERN) },
    })
    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["Plan!2:3", "Plan!9:9"])
    expect(h.calls()[1]!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("does not count the top-left cell of a merge, nor the cells a merge by columns or rows keeps", async () => {
    const rows = [
      ["a", "b"],
      ["c", "d"],
    ]
    const countOf = async (merge: object) =>
      (
        await describeCall(
          call({ op: "merge", range: "Plan!A1:B2", ...merge }),
          await writeFixture(handlers(() => rows)),
        )
      ).facts[0]

    expect(await countOf({})).toEqual({ label: "Overwrites", value: { text: "{count} cells", values: { count: 3 } } })
    expect(await countOf({ merge: "columns" })).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 2 } },
    })
    expect(await countOf({ merge: "rows" })).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 2 } },
    })
  })

  test("reads the whole tab for a tab that is deleted, and pins the titles of the tabs renamed and deleted", async () => {
    const h = await writeFixture(handlers((range) => (range === "'My Tab'" ? [["x", "y"], ["z"]] : [])))

    const description = await describeCall(
      call({ op: "tab_delete", tab: "my tab" }, { op: "tab_rename", tab: "plan", title: "Budget" }),
      h,
    )

    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["'My Tab'"])
    expect(description.facts).toEqual([
      { label: "Overwrites", value: { text: "{count} cells", values: { count: 3 } } },
      { label: "Checks", value: { text: "none" } },
      { label: "Tabs", value: "Plan, My Tab" },
      { label: "Operations", value: { text: "{count} operations", values: { count: 2 } } },
    ])
    expect(description.headline!.text).toBe("About to restructure {spreadsheet}")
    expect(description.text!.body).toBe("tab_delete 'My Tab' with all its contents\ntab_rename Plan to \"Budget\"")
    expect(description.pins).toEqual({
      values: expect.stringMatching(PIN_PATTERN),
      titles: JSON.stringify(["Plan", "My Tab"]),
    })
  })

  test("reads nothing and pins no title for a call that loses no value and renames no tab", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(
      call({ op: "move", range: "Plan!2:3", to: 9 }, { op: "spreadsheet_settings", locale: "ja_JP" }),
      h,
    )

    expect(description.facts.slice(0, 3)).toEqual([
      { label: "Overwrites", value: { text: "{count} cells", values: { count: 0 } } },
      { label: "Checks", value: { text: "none" } },
      { label: "Tabs", value: "Plan" },
    ])
    expect(description.headline!.text).toBe("About to restructure {spreadsheet}")
    expect(Object.keys(description.pins!)).toEqual(["values"])
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`])
  })

  test("gives the same pins for the same state, other pins when a lost cell or a renamed tab's title changed", async () => {
    const args = call({ op: "delete", range: "Plan!2:2" }, { op: "spreadsheet_rename", title: "X" })
    const first = await describeCall(args, await writeFixture(handlers(() => [["a"]])))
    const again = await describeCall(args, await writeFixture(handlers(() => [["a"]])))
    const changed = await describeCall(args, await writeFixture(handlers(() => [["b"]])))

    expect(again).toEqual(first)
    expect(changed.pins!.values).not.toBe(first.pins!.values)
    expect(changed.facts).toEqual(first.facts)
  })

  test("pins another title when the tab to rename is titled otherwise by the time the call runs", async () => {
    const args = call({ op: "tab_rename", tab: "plan", title: "Budget" })
    const retitled = { properties: { title: "Budget 2027" }, sheets: [{ properties: { title: "PLAN" } }] }

    const before = await describeCall(args, await writeFixture(handlers()))
    const after = await describeCall(args, await writeFixture([metadata(retitled)]))

    expect(before.pins).toEqual({ titles: '["Plan"]', values: expect.stringMatching(PIN_PATTERN) })
    expect(after.pins!.titles).toBe('["PLAN"]')
  })

  test("is accepted by the description check, and throws where the call would refuse", async () => {
    const h = await writeFixture(handlers())

    const answer = await callDescription(googleSheetsRestructure, call({ op: "delete", range: "Plan!2:2" }), h.ctx)
    expect(answer?.pins?.values).toMatch(PIN_PATTERN)
    expect(answer?.facts).toHaveLength(4)

    const error = await toolError(Promise.resolve(describeCall(call({ op: "delete", range: "Nope!2:2" }), h)))
    expect(error.code).toBe("invalid_argument")
    expect(
      await callDescription(googleSheetsRestructure, call({ op: "delete", range: "Nope!2:2" }), h.ctx),
    ).toBeUndefined()
  })
})
