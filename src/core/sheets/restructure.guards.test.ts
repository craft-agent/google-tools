import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { BATCH_GET_URL, SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { ONLY_PLAN, WITH_HIDDEN_TAB, sendRestructure } from "./structure.testing"
import { BATCH_UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** Runs a call that is refused, and returns its error with the proof that nothing was written. */
async function refused(operations: unknown[], spreadsheet?: unknown) {
  const h = await writeFixture([metadata(spreadsheet), valuesHandler(() => []), post(BATCH_UPDATE_URL)])
  const error = await toolError(h.restructure({ spreadsheet: SPREADSHEET_ID, operations }))
  expect(writesOf(h.requests)).toEqual([])
  return error
}

describe("google_sheets_restructure: operations that shift cells", () => {
  test.each([
    [
      "a delete and a merge",
      [
        { op: "delete", range: "Plan!2:3" },
        { op: "merge", range: "Plan!A1:B2" },
      ],
      "Operation 1 (delete)",
      "operation 2 (merge)",
    ],
    [
      "a move and a rename",
      [
        { op: "move", range: "Plan!B:B", to: "E" },
        { op: "tab_rename", tab: "Plan", title: "New" },
      ],
      "Operation 1 (move)",
      "operation 2 (tab_rename)",
    ],
    [
      "a delete and a delete",
      [
        { op: "delete", range: "My Tab!2:3" },
        { op: "spreadsheet_rename", title: "X" },
        { op: "delete", range: "'My Tab'!9:9" },
      ],
      "Operation 1 (delete)",
      "operation 3 (delete)",
    ],
    [
      "a delete and a tab deleted",
      [
        { op: "delete", range: "a/b!2:3" },
        { op: "tab_delete", tab: "a/b" },
      ],
      "Operation 1 (delete)",
      "operation 2 (tab_delete)",
    ],
  ])("refuses %s on one tab, naming both operations and the tab", async (_name, operations, first, second) => {
    const error = await refused(operations)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(first)
    expect(error.message).toContain(second)
    expect(error.message).toContain("other cells than the prompt shows")
  })

  test("names the tab, by the title Google reports", async () => {
    const error = await refused([
      { op: "delete", range: "my tab!2:3" },
      { op: "merge", range: "'MY TAB'!A1:B2" },
    ])

    expect(error.message).toContain('shifts the cells of "My Tab"')
  })

  test("takes later operations on other tabs and on the spreadsheet, and earlier ones on the same tab", async () => {
    const { body } = await sendRestructure([
      { op: "merge", range: "Plan!A1:B2" },
      { op: "delete", ranges: ["Plan!5:6", "Plan!9:9"] },
      { op: "move", range: "'My Tab'!A:A", to: "D" },
      { op: "merge", range: "a/b!A1:B2" },
      { op: "spreadsheet_settings", locale: "ja_JP" },
      { op: "spreadsheet_rename", title: "Renamed" },
    ])

    expect(body.requests).toHaveLength(7)
  })
})

describe("google_sheets_restructure: tab_delete", () => {
  test("refuses the only tab, and the only visible tab, and sends nothing", async () => {
    for (const [spreadsheet, tab] of [
      [ONLY_PLAN, "Plan"],
      [WITH_HIDDEN_TAB, "a/b"],
    ] as const) {
      const operations =
        tab === "a/b"
          ? [
              { op: "tab_delete", tab: "Plan" },
              { op: "tab_delete", tab },
            ]
          : [{ op: "tab_delete", tab }]

      const error = await refused(operations, spreadsheet)

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("only visible tab")
      expect(error.message).toContain(JSON.stringify(tab))
    }
  })

  test("deletes a hidden tab, and a visible one while another visible tab stays", async () => {
    const { body } = await sendRestructure(
      [
        { op: "tab_delete", tab: "My Tab" },
        { op: "tab_delete", tab: "Plan" },
      ],
      { spreadsheet: WITH_HIDDEN_TAB },
    )

    expect(body.requests).toEqual([{ deleteSheet: { sheetId: 77 } }, { deleteSheet: { sheetId: 0 } }])
  })

  test("refuses a later operation on a tab an earlier one deleted, naming the tabs that are left", async () => {
    const error = await refused([
      { op: "tab_delete", tab: "a/b" },
      { op: "tab_rename", tab: "a/b", title: "Back" },
    ])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Plan, My Tab")
  })

  test("refuses a tab the spreadsheet lacks", async () => {
    const error = await refused([{ op: "tab_delete", tab: "Nope" }])

    expect(error.message).toContain("Plan, My Tab, a/b")
  })
})

describe("google_sheets_restructure: tab_rename", () => {
  test.each([
    ["the title of another tab, in other case", [{ op: "tab_rename", tab: "Plan", title: "MY TAB" }]],
    [
      "a title an earlier rename of the call gave",
      [
        { op: "tab_rename", tab: "Plan", title: "X" },
        { op: "tab_rename", tab: "My Tab", title: "x" },
      ],
    ],
  ])("refuses %s", async (_name, operations) => {
    const error = await refused(operations)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must be new, ignoring case")
  })

  test("takes the title of a tab that was renamed away or deleted earlier in the call, and a new case for the tab's own title", async () => {
    const { body } = await sendRestructure([
      { op: "tab_rename", tab: "Plan", title: "Old plan" },
      { op: "tab_rename", tab: "My Tab", title: "plan" },
      { op: "tab_delete", tab: "a/b" },
      { op: "tab_rename", tab: "Old plan", title: "A/B" },
      { op: "tab_rename", tab: "plan", title: "PLAN" },
    ])

    expect(
      body.requests.map(
        (request) =>
          (request as { updateSheetProperties?: { properties: { title: string } } }).updateSheetProperties?.properties
            .title,
      ),
    ).toEqual(["Old plan", "plan", undefined, "A/B", "PLAN"])
  })

  test("refuses an empty title, a title over 100 characters and an unknown tab", async () => {
    for (const operation of [
      { op: "tab_rename", tab: "Plan", title: "" },
      { op: "tab_rename", tab: "Plan", title: "x".repeat(101) },
      { op: "tab_rename", tab: "Nope", title: "New" },
      { op: "tab_rename", tab: "Plan" },
    ]) {
      expect((await refused([operation])).code).toBe("invalid_argument")
    }
  })
})

describe("google_sheets_restructure: expect", () => {
  const EXPECT = [{ range: "Plan!A2", value: "Pens" }]

  test("checks the cells, then reads what is lost, then writes: in that order, in one batch", async () => {
    const h = await writeFixture([
      metadata(),
      valuesHandler((range, render) => (render === "FORMATTED_VALUE" ? [["Pens"]] : [["Pens", 3]])),
      post(BATCH_UPDATE_URL),
    ])

    const result = await h.restructure({
      spreadsheet: SPREADSHEET_ID,
      operations: [{ op: "delete", range: "Plan!2:2" }],
      expect: EXPECT,
    })

    expect(h.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${SPREADSHEET_URL}:batchUpdate`,
    ])
    const renders = h.calls().map((call) => call.url.searchParams.get("valueRenderOption"))
    expect(renders.slice(1, 3)).toEqual(["FORMATTED_VALUE", "FORMULA"])
    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["Plan!A2"])
    expect(h.calls()[2]!.url.searchParams.getAll("ranges")).toEqual(["Plan!2:2"])
    expect(result.before).toEqual([{ range: "Plan!2:2", values: [["Pens", 3]] }])
  })

  test("fails as stale, naming the cell that differs, when a cell shows something else, and writes nothing", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => [["Staples"]]), post(BATCH_UPDATE_URL)])

    const error = await toolError(
      h.restructure({
        spreadsheet: SPREADSHEET_ID,
        operations: [
          { op: "delete", range: "Plan!2:2" },
          { op: "tab_delete", tab: "a/b" },
        ],
        expect: EXPECT,
      }),
    )

    expect(error.code).toBe("stale")
    expect(error.message).toContain('Plan!A2: expected "Pens", found "Staples"')
    expect(writesOf(h.requests)).toEqual([])
    expect(h.calls().filter((call) => call.url.pathname.endsWith("batchGet"))).toHaveLength(1)
  })

  test("takes no more than 200 cells to check", async () => {
    const cells = Array.from({ length: 201 }, () => EXPECT[0])
    const h = await writeFixture([metadata()])

    const error = await toolError(
      h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "delete", range: "Plan!2:2" }], expect: cells }),
    )

    expect(error.code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_restructure: a label that cannot write", () => {
  test("fails before any request", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => []), post(BATCH_UPDATE_URL)], SHEETS_CREDENTIAL)

    const error = await toolError(
      h.restructure({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "delete", range: "Plan!2:2" }] }),
    )

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})
