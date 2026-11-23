import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"
import { PLAN_GRID as range } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STRUCTURE = { method: "structure", spreadsheet: SPREADSHEET_ID }

describe("google_sheets_read structure: the lists are capped", () => {
  const many = (count: number) => Array.from({ length: count }, (_, row) => range(row, row + 1, 0, 2))

  test("lists the first 50 of each and counts the rest in `more`", async () => {
    const sheet = {
      properties: { title: "Big" },
      merges: many(120),
      tables: Array.from({ length: 51 }, (_, index) => ({
        tableId: `t${index}`,
        name: `T${index}`,
        range: range(0, 1, 0, 1),
      })),
      conditionalFormats: many(60).map((block) => ({ ranges: [block], gradientRule: {} })),
      filterViews: Array.from({ length: 70 }, (_, index) => ({
        filterViewId: index,
        title: `V${index}`,
        range: range(0, 1, 0, 1),
      })),
      charts: Array.from({ length: 52 }, (_, index) => ({ chartId: index, spec: {}, position: {} })),
      protectedRanges: Array.from({ length: 50 }, (_, index) => ({
        protectedRangeId: index,
        range: range(0, 1, 0, 1),
      })),
      rowGroups: Array.from({ length: 55 }, (_, index) => ({
        range: { startIndex: index, endIndex: index + 1 },
        depth: 1,
      })),
      columnGroups: [{ range: { startIndex: 0, endIndex: 1 }, depth: 1 }],
    }
    const h = await fixture([answer(SPREADSHEET_URL, { sheets: [sheet] })])

    const [tab] = (await h.read(STRUCTURE)).structure!

    expect(tab!.merges).toHaveLength(50)
    expect(tab!.merges.at(-1)).toBe("Big!A50:B50")
    expect(tab!.tables).toHaveLength(50)
    expect(tab!.conditional_rules.map((rule) => rule.index)).toEqual(Array.from({ length: 50 }, (_, index) => index))
    expect(tab!.filter_views).toHaveLength(50)
    expect(tab!.charts).toHaveLength(50)
    expect(tab!.protections).toHaveLength(50)
    expect(tab!.row_groups).toHaveLength(50)
    expect(tab!.column_groups).toHaveLength(1)
    expect(tab!.more).toEqual({
      merges: 70,
      row_groups: 5,
      column_groups: 0,
      tables: 1,
      conditional_rules: 10,
      filter_views: 20,
      charts: 2,
      pivots: 0,
      protections: 0,
    })
  })

  test("lists the first 50 columns of a table and counts the rest, and the first 50 criteria of a filter with the count of the rest as the last entry", async () => {
    const sheet = {
      properties: { title: "Wide" },
      tables: [
        {
          tableId: "t",
          name: "T",
          range: range(0, 5, 1, 60),
          columnProperties: Array.from({ length: 53 }, (_, index) => ({ columnIndex: index, columnName: `C${index}` })),
        },
      ],
      basicFilter: {
        range: range(0, 5, 0, 60),
        filterSpecs: Array.from({ length: 52 }, (_, index) => ({
          columnIndex: index,
          filterCriteria: { hiddenValues: ["v"] },
        })),
      },
    }
    const h = await fixture([answer(SPREADSHEET_URL, { sheets: [sheet] })])

    const [tab] = (await h.read(STRUCTURE)).structure!

    expect(tab!.tables[0]!.columns).toHaveLength(50)
    expect(tab!.tables[0]!.columns[49]).toEqual({ column: "AY", name: "C49", type: "TEXT" })
    expect(tab!.tables[0]!.more_columns).toBe(3)
    expect(tab!.basic_filter!.criteria).toHaveLength(51)
    expect(tab!.basic_filter!.criteria.at(-1)).toBe("+2 more")
  })
})
