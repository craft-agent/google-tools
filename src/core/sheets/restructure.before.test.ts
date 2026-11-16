import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_sheets_restructure: before", () => {
  test("returns the values of the rows and columns a delete removes, formulas as written, by range", async () => {
    const { result, h } = await sendRestructure([{ op: "delete", ranges: ["Plan!2:3", "'My Tab'!B:B"] }], {
      rows: (range) => (range === "Plan!2:3" ? [["Pens", 3, "=B2*2"], [], [null, true]] : [["x"], ["y"]]),
    })

    expect(result).toMatchObject({
      spreadsheet_id: SPREADSHEET_ID,
      before: [
        { range: "Plan!2:3", values: [["Pens", 3, "=B2*2"], [""], [null, true]] },
        { range: "'My Tab'!B:B", values: [["x"], ["y"]] },
      ],
      before_truncated: false,
    })
    expect(h.calls()[1]!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
  })

  test("returns the whole range a merge covers, the cell that stays included", async () => {
    const { result } = await sendRestructure([{ op: "merge", range: "Plan!A1:B2" }], {
      rows: () => [
        ["a", "b"],
        ["c", "d"],
      ],
    })

    expect(result.before).toEqual([
      {
        range: "Plan!A1:B2",
        values: [
          ["a", "b"],
          ["c", "d"],
        ],
      },
    ])
  })

  test("returns the contents of a deleted tab, read as the whole tab", async () => {
    const { result, h } = await sendRestructure([{ op: "tab_delete", tab: "a/b" }], {
      rows: () => [
        ["id", "name"],
        [1, "Ann"],
      ],
    })

    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["'a/b'"])
    expect(result.before).toEqual([
      {
        range: "'a/b'",
        values: [
          ["id", "name"],
          [1, "Ann"],
        ],
      },
    ])
    expect(result.before_truncated).toBe(false)
  })

  test("reads a range by the title the tab has now, though an earlier rename of the call gave it another", async () => {
    const { h } = await sendRestructure([
      { op: "tab_rename", tab: "Plan", title: "Budget" },
      { op: "merge", range: "Budget!A1:B2" },
    ])

    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["Plan!A1:B2"])
  })

  test("is empty, and asks Google for no values, for a call that loses none", async () => {
    const { result, h } = await sendRestructure([
      { op: "tab_rename", tab: "Plan", title: "Budget" },
      { op: "move", range: "Budget!2:3", to: 9 },
      { op: "spreadsheet_rename", title: "Budget 2028" },
    ])

    expect(result).toMatchObject({ before: [], before_truncated: false })
    expect(h.names().filter((name) => name.includes("values:batchGet"))).toEqual([])
  })

  test("is null, with before_truncated, when the rows hold more cells than a read returns, and the call still lands", async () => {
    const { result, body } = await sendRestructure([{ op: "delete", range: "Plan!1:20000" }], {
      rows: () => Array.from({ length: 10_001 }, () => ["x"]),
    })

    expect(result).toMatchObject({ before: null, before_truncated: true, requests: 1 })
    expect(body.requests).toHaveLength(1)
  })

  test("is null when a text cell is longer than a read returns", async () => {
    const { result } = await sendRestructure([{ op: "delete", range: "Plan!2:2" }], {
      rows: () => [["x".repeat(2_001)]],
    })

    expect(result).toMatchObject({ before: null, before_truncated: true })
  })

  test("returns what each operation applied, how many requests they made, and the tabs they changed", async () => {
    const { result } = await sendRestructure([
      { op: "delete", range: "a/b!2:2" },
      { op: "merge", range: "Plan!A1:B1" },
      { op: "spreadsheet_settings", time_zone: "Asia/Tokyo" },
    ])

    expect(result).toMatchObject({
      applied: ["delete 'a/b'!2:2", "merge Plan!A1:B1", "spreadsheet_settings time zone Asia/Tokyo"],
      requests: 3,
      tabs: ["Plan", "a/b"],
    })
  })
})
