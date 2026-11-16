import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { googleSheetsFormat } from "./format"
import { send } from "./format.testing"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { BATCH_UPDATE_URL, SPREADSHEET, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const ROWS = { sheetId: 0, dimension: "ROWS" }
const SPAN_2_4 = { ...ROWS, startIndex: 1, endIndex: 4 }

/** The spreadsheet with `Plan` holding two groups of rows: 1 to 10, and 2 to 4 inside it. */
const GROUPED = {
  ...SPREADSHEET,
  sheets: [
    {
      ...SPREADSHEET.sheets[2]!,
      rowGroups: [
        { range: { ...ROWS, startIndex: 0, endIndex: 10 }, depth: 1 },
        { range: SPAN_2_4, depth: 2 },
      ],
    },
    ...SPREADSHEET.sheets.slice(0, 2),
  ],
}

const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

describe("google_sheets_format: group is idempotent", () => {
  test("a span that already is a group adds nothing, and without `collapsed` sends nothing for the operation", async () => {
    const { body } = await send(
      [
        { op: "group", range: "Plan!2:4" },
        { op: "hide", range: "Plan!1" },
      ],
      GROUPED,
    )

    expect(body.requests.map((request) => Object.keys(request as object))).toEqual([["updateDimensionProperties"]])
  })

  test("with `collapsed` it sends only the update, at the depth the existing group has", async () => {
    const { body } = await send([{ op: "group", ranges: ["Plan!2:4", "Plan!1:10"], collapsed: true }], GROUPED)

    expect(body.requests).toEqual([
      { updateDimensionGroup: { dimensionGroup: { range: SPAN_2_4, depth: 2, collapsed: true }, fields: "collapsed" } },
      {
        updateDimensionGroup: {
          dimensionGroup: { range: { ...ROWS, startIndex: 0, endIndex: 10 }, depth: 1, collapsed: true },
          fields: "collapsed",
        },
      },
    ])
  })

  test("grouping the same new span twice in one call adds it once", async () => {
    const plain = await send([
      { op: "group", range: "Plan!6:8" },
      { op: "group", range: "Plan!6:8" },
    ])
    const collapsed = await send([
      { op: "group", range: "Plan!6:8" },
      { op: "group", range: "Plan!6:8", collapsed: true },
    ])

    const span = { ...ROWS, startIndex: 5, endIndex: 8 }
    expect(plain.body.requests).toEqual([{ addDimensionGroup: { range: span } }])
    expect(collapsed.body.requests).toEqual([
      { addDimensionGroup: { range: span } },
      { updateDimensionGroup: { dimensionGroup: { range: span, depth: 1, collapsed: true }, fields: "collapsed" } },
    ])
  })

  test("a span that is only inside a group is a new group, one level deeper", async () => {
    const { body } = await send([{ op: "group", range: "Plan!3:4", collapsed: true }], GROUPED)

    const span = { ...ROWS, startIndex: 2, endIndex: 4 }
    expect(body.requests).toEqual([
      { addDimensionGroup: { range: span } },
      { updateDimensionGroup: { dimensionGroup: { range: span, depth: 3, collapsed: true }, fields: "collapsed" } },
    ])
  })

  test("says in the line of the prompt and in `applied` that the span is already grouped", async () => {
    const h = await writeFixture([metadata(GROUPED), post(BATCH_UPDATE_URL)])
    const args = call(
      { op: "group", range: "Plan!2:4" },
      { op: "group", ranges: ["Plan!2:4", "Plan!6:8"], collapsed: true },
      { op: "group", range: "Plan!6:8" },
    )
    const lines = [
      "group Plan!2:4 (already grouped)",
      "group Plan!2:4, Plan!6:8 collapsed (1 already grouped)",
      "group Plan!6:8 (already grouped)",
    ]

    const description = await googleSheetsFormat.describe!(googleSheetsFormat.input.parse(args), h.ctx)
    const result = await h.format(args)

    expect(description.text!.body.split("\n")).toEqual(lines)
    expect(result.applied).toEqual(lines)
  })
})

describe("google_sheets_format: ungroup", () => {
  test("removes a group that is there, and one made earlier in the call", async () => {
    const { body } = await send(
      [
        { op: "ungroup", range: "Plan!2:4" },
        { op: "group", range: "Plan!6:8" },
        { op: "ungroup", range: "Plan!6:8" },
      ],
      GROUPED,
    )

    expect(body.requests.map((request) => Object.keys(request as object))).toEqual([
      ["deleteDimensionGroup"],
      ["addDimensionGroup"],
      ["deleteDimensionGroup"],
    ])
  })

  test.each([
    ["a span that is not a group", [{ op: "ungroup", range: "Plan!3:4" }], '"Plan!3:4"'],
    ["a span only inside a group", [{ op: "ungroup", range: "Plan!1:5" }], '"Plan!1:5"'],
    [
      "a span already ungrouped earlier in the call",
      [
        { op: "ungroup", range: "Plan!2:4" },
        { op: "ungroup", range: "Plan!2:4" },
      ],
      '"Plan!2:4"',
    ],
    ["columns of a tab with no group", [{ op: "ungroup", range: "'My Tab'!B:C" }], "'My Tab'!B:C"],
  ])("refuses %s, naming it, before anything is sent", async (_name, operations, span) => {
    const h = await writeFixture([metadata(GROUPED), post(BATCH_UPDATE_URL)])

    const error = await toolError(h.format(call({ op: "hide", range: "Plan!1" }, ...operations)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(span)
    expect(error.message).toContain("is not a group")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("its targets are `*` and its description throws, as for any refused call", async () => {
    const h = await writeFixture([metadata(GROUPED), post(BATCH_UPDATE_URL)])
    const args = googleSheetsFormat.input.parse(call({ op: "ungroup", range: "Plan!3:4" }))

    expect(await googleSheetsFormat.targets!(args, h.ctx)).toEqual(["*"])
    expect((await toolError(Promise.resolve(googleSheetsFormat.describe!(args, h.ctx)))).code).toBe("invalid_argument")
  })
})
