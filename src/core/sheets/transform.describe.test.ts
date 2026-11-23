import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isAbortError } from "../errors"
import { toolError } from "../google/client.fixtures"
import { PIN_PATTERN } from "../pin"
import { writeTargets } from "../targets"
import { annotations } from "../tool"
import { BATCH_GET_URL, SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { WITH_OBJECTS } from "./structure.testing"
import { googleSheetsTransform } from "./transform"
import { call, describeTransform, refusedTransform, sendTransform } from "./transform.testing"
import { BATCH_UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}`

const OVERWRITES = (count: number) => ({
  label: "Overwrites",
  value: { text: count === 1 ? "{count} cell" : "{count} cells", values: { count } },
})

describe("google_sheets_transform: class and bounds", () => {
  test("administrative: destructive and not idempotent, since a cut or a replacement can change more on a second run", () => {
    expect(googleSheetsTransform).toMatchObject({ toolset: "sheets", class: "administrative" })
    expect(annotations(googleSheetsTransform)).toEqual({
      title: "Transform a Google spreadsheet",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  test("bounds the operations and the ranges, measured from the arguments", () => {
    expect(googleSheetsTransform.bounds).toMatchObject({ operations: { kind: "max" }, ranges: { kind: "max" } })

    const measured = googleSheetsTransform.measure!(
      googleSheetsTransform.input.parse(
        call(
          { op: "trim", ranges: ["Plan!A1:B2", "Plan!C1:C2"] },
          { op: "find_replace", find: "a", all_tabs: true },
          { op: "copy", range: "Plan!A1:B2", to: "E1" },
        ),
      ),
      { cwd: "/" },
    )

    expect(measured).toEqual({ operations: 3, ranges: 3 })
  })

  test("takes 1 to 100 operations and 500 ranges at most", () => {
    const parse = (...operations: unknown[]) => googleSheetsTransform.input.safeParse(call(...operations)).success
    const trim = { op: "trim", range: "Plan!A1:B2" }

    expect(parse()).toBe(false)
    expect(parse(...Array.from({ length: 100 }, () => trim))).toBe(true)
    expect(parse(...Array.from({ length: 101 }, () => trim))).toBe(false)
    expect(parse({ op: "trim", ranges: Array.from({ length: 501 }, () => "Plan!A1:B2") })).toBe(false)
  })

  test("says what its result holds and that the call is asked every time", () => {
    expect(googleSheetsTransform.description).toContain("The result's `before` holds the values the call may replace")
    expect(googleSheetsTransform.description).toContain("asked about every time")
    expect(googleSheetsTransform.description).toContain("never instructions")
  })
})

describe("google_sheets_transform: targets", () => {
  const targetsOf = async (operations: unknown[], spreadsheet?: unknown) => {
    const h = await writeFixture([metadata(spreadsheet)])
    return writeTargets(googleSheetsTransform, call(...operations), h.ctx)
  }

  test("names each tab a call changes, sorted: both tabs of a cut, only the destination of a copy", async () => {
    expect(
      await targetsOf([
        { op: "cut", range: "'My Tab'!A1:B2", to: "Plan!D1" },
        { op: "copy", range: "Plan!A1:B2", to: "'a/b'!A1" },
      ]),
    ).toEqual([`${BASE}/sheets/0`, `${BASE}/sheets/5`, `${BASE}/sheets/77`])
    expect(await targetsOf([{ op: "copy", range: "Plan!A1:B2", to: "'a/b'!A1" }])).toEqual([`${BASE}/sheets/5`])
  })

  test("names every tab for a find_replace over all tabs, and one for a tab", async () => {
    expect(await targetsOf([{ op: "find_replace", find: "a", all_tabs: true }])).toEqual([
      `${BASE}/sheets/0`,
      `${BASE}/sheets/5`,
      `${BASE}/sheets/77`,
    ])
    expect(await targetsOf([{ op: "find_replace", find: "a", tab: "My Tab" }])).toEqual([`${BASE}/sheets/77`])
  })

  test.each([
    ["a tab the spreadsheet lacks", { op: "trim", range: "Nope!A1:B2" }],
    ["a range that is not closed", { op: "trim", range: "Plan!A:B" }],
    ["a copy with a destination that is not a cell", { op: "copy", range: "Plan!A1:B2", to: "D1:E2" }],
    ["an operation outside the vocabulary", { op: "delete", range: "Plan!2:3" }],
  ])("are `*` for %s", async (_name, operation) => {
    expect(await targetsOf([operation])).toEqual(["*"])
  })

  test("are `*` for a label that cannot write, before any request, and pass a cancellation on", async () => {
    const readOnly = await writeFixture([metadata()], SHEETS_CREDENTIAL)
    expect(await writeTargets(googleSheetsTransform, call({ op: "trim", range: "Plan!A1:B2" }), readOnly.ctx)).toEqual([
      "*",
    ])
    expect(readOnly.requests).toEqual([])

    const h = await writeFixture([metadata()])
    const controller = new AbortController()
    controller.abort()
    const error = await writeTargets(googleSheetsTransform, call({ op: "trim", range: "Plan!A1:B2" }), {
      ...h.ctx,
      signal: controller.signal,
    }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
  })
})

describe("google_sheets_transform: describe", () => {
  test("names the tab, counts the filled cells a sort may replace below the header, and pins their values", async () => {
    const { description, h } = await describeTransform(
      [{ op: "sort", range: "Plan!A1:C20", by: [{ column: "B", order: "desc" }] }],
      {
        rows: () => [
          ["Pens", 3, ""],
          [null, "=A1"],
        ],
      },
      { expect: [{ range: "Plan!A1", value: "Item" }] },
    )

    expect(description).toEqual({
      headline: {
        text: "About to transform {tab} in {spreadsheet}",
        values: { tab: "Plan", spreadsheet: "Budget 2027" },
      },
      facts: [
        OVERWRITES(3),
        { label: "Checks", value: { text: "{count} check", values: { count: 1 } } },
        { label: "Tabs", value: "Plan" },
        { label: "Operations", value: { text: "{count} operation", values: { count: 1 } } },
      ],
      text: { label: "Operations", body: "sort Plan!A1:C20 by B desc, row 1 stays as the header" },
      pins: { values: expect.stringMatching(PIN_PATTERN) },
    })
    const read = h.calls().find((call) => call.url.pathname.endsWith("/values:batchGet"))!
    expect(read.url.searchParams.getAll("ranges")).toEqual(["Plan!A2:C20"])
    expect(read.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("names the spreadsheet when the call changes several tabs, and counts a find_replace over every tab's grid", async () => {
    const { description, h } = await describeTransform([{ op: "find_replace", find: "a", all_tabs: true }], {
      rows: (range) => (range === "Plan" ? [["a", "b"], ["c"]] : [["d"]]),
    })

    expect(description.headline).toEqual({
      text: "About to transform {spreadsheet}",
      values: { spreadsheet: "Budget 2027" },
    })
    expect(description.facts[0]).toEqual(OVERWRITES(5))
    expect(description.facts[2]).toEqual({ label: "Tabs", value: "Plan, My Tab, a/b" })
    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["Plan", "'My Tab'", "'a/b'"])
  })

  test("counts the cells a cut moves and the ones it covers once where the destination overlaps the source", async () => {
    const { description } = await describeTransform([{ op: "cut", range: "Plan!A1:B2", to: "B2" }], {
      rows: (range) =>
        range === "Plan!A1:B2"
          ? [
              ["a", "b"],
              ["c", "d"],
            ]
          : [
              ["d", "e"],
              ["f", "g"],
            ],
    })

    expect(description.facts[0]).toEqual(OVERWRITES(7))
  })

  test("reads the columns a split_text covers, to the tab's last one", async () => {
    const { description, h } = await describeTransform([{ op: "split_text", range: "Plan!B2:B3" }], {
      spreadsheet: WITH_OBJECTS,
      rows: () => [["a;b", "x"], ["c"]],
    })

    expect(h.calls().at(-1)!.url.searchParams.getAll("ranges")).toEqual(["Plan!B2:J3"])
    expect(description.facts[0]).toEqual(OVERWRITES(3))
  })

  test("gives the same pins for the same state, and other pins when a value the call may replace changed", async () => {
    const operations = [{ op: "trim", range: "Plan!A1:B1" }]
    const first = await describeTransform(operations, { rows: () => [["a"]] })
    const again = await describeTransform(operations, { rows: () => [["a"]] })
    const changed = await describeTransform(operations, { rows: () => [["b"]] })

    expect(again.description).toEqual(first.description)
    expect(changed.description.pins!.values).not.toBe(first.description.pins!.values)
  })

  test("throws where the call would refuse", async () => {
    const error = await toolError(
      describeTransform([{ op: "trim", range: "Nope!A1:B2" }]).then(({ description }) => description),
    )

    expect(error.code).toBe("invalid_argument")
  })
})

describe("google_sheets_transform: before", () => {
  test("returns what a sort may replace below the header, formulas as written", async () => {
    const { result } = await sendTransform([{ op: "sort", range: "Plan!A1:B3", by: [{ column: "A" }] }], {
      rows: () => [["x", "=A1"], [], [3]],
    })

    expect(result).toMatchObject({
      before: [{ range: "Plan!A2:B3", values: [["x", "=A1"], [""], [3]] }],
      before_truncated: false,
    })
  })

  test("returns the columns a split_text overwrites, from its range to the tab's last column", async () => {
    const { result } = await sendTransform([{ op: "split_text", range: "Plan!B2:B3", delimiter: ";" }], {
      spreadsheet: WITH_OBJECTS,
      rows: () => [["a;b", "x"]],
    })

    expect(result.before).toEqual([{ range: "Plan!B2:J3", values: [["a;b", "x"]] }])
  })

  test("is null, with before_truncated, when the cells hold more than a read returns, and the call still lands", async () => {
    const { result, requests } = await sendTransform([{ op: "find_replace", find: "a", tab: "Plan" }], {
      rows: () => Array.from({ length: 10_001 }, () => ["x"]),
    })

    expect(result).toMatchObject({ before: null, before_truncated: true, requests: 1 })
    expect(requests).toHaveLength(1)
  })

  test("returns what each operation applied, the requests they made and the tabs they changed", async () => {
    const { result } = await sendTransform([
      { op: "trim", ranges: ["Plan!A1:B2", "Plan!C1:C2"] },
      { op: "note", range: "'a/b'!A1", text: "n" },
    ])

    expect(result).toMatchObject({
      applied: ["trim Plan!A1:B2, Plan!C1:C2", "note 'a/b'!A1 \"n\""],
      requests: 3,
      tabs: ["Plan", "a/b"],
      results: [{ op: "trim", cells_changed: 0 }, { op: "note" }],
    })
  })
})

describe("google_sheets_transform: expect", () => {
  const EXPECT = [{ range: "Plan!A2", value: "Pens" }]

  test("checks the cells, then reads what may be replaced, then writes: in that order, in one batch", async () => {
    const h = await writeFixture([
      metadata(),
      valuesHandler((_range, render) => (render === "FORMATTED_VALUE" ? [["Pens"]] : [["Pens", 3]])),
      post(BATCH_UPDATE_URL),
    ])

    const result = await h.transform({ ...call({ op: "trim", range: "Plan!A2:B2" }), expect: EXPECT })

    expect(h.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${SPREADSHEET_URL}:batchUpdate`,
    ])
    expect(
      h
        .calls()
        .slice(1, 3)
        .map((request) => request.url.searchParams.get("valueRenderOption")),
    ).toEqual(["FORMATTED_VALUE", "FORMULA"])
    expect(result.before).toEqual([{ range: "Plan!A2:B2", values: [["Pens", 3]] }])
  })

  test("fails as stale, naming the cell that differs, and writes nothing", async () => {
    const error = await refusedTransform([{ op: "cut", range: "Plan!A2:B2", to: "D2" }], {
      rows: () => [["Staples"]],
      expect: EXPECT,
    })

    expect(error.code).toBe("stale")
    expect(error.message).toContain('Plan!A2: expected "Pens", found "Staples"')
  })
})

describe("google_sheets_transform: a label that cannot write", () => {
  test("fails before any request", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)], SHEETS_CREDENTIAL)

    const error = await toolError(h.transform(call({ op: "trim", range: "Plan!A1:B2" })))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})
