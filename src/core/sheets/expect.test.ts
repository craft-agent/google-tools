import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { MAX_EXPECT, plain } from "./expect"
import { BATCH_GET_URL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { CLEAR_URL, UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const EDIT = { spreadsheet: SPREADSHEET_ID, data: [{ range: "Plan!A2:B2", values: [["x", 1]] }] }

/** What the guarded cells show, by range, as the sheet displays them. */
const shown = (cells: Record<string, string>) =>
  valuesHandler((range, render) => (render === "FORMATTED_VALUE" && range in cells ? [[cells[range]!]] : []))

describe("plain", () => {
  test.each([
    ["  Name ", "Name"],
    [5, "5"],
    [1.5, "1.5"],
    [true, "TRUE"],
    [false, "FALSE"],
    ["", ""],
  ])("%p is %p", (value, text) => {
    expect(plain(value)).toBe(text)
  })
})

describe("expect: arguments", () => {
  test.each([
    ["a range of cells", "Plan!A1:B2"],
    ["a tab", "Plan"],
    ["a column", "Plan!A:A"],
    ["a row 0", "Plan!A0"],
    ["a column of four letters", "Plan!ABCD1"],
    ["an absolute cell", "Plan!$A$1"],
    ["a malformed tab", "'Plan!A1"],
    ["nothing after the tab", "Plan!"],
  ])("refuses %s as a guard, before any request", async (_name, range) => {
    const h = await writeFixture([metadata()])

    const error = await toolError(h.edit({ ...EDIT, expect: [{ range, value: "x" }] }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must be one cell")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["none", []],
    ["201 guards", Array.from({ length: MAX_EXPECT + 1 }, () => ({ range: "A1", value: "x" }))],
    ["a null value", [{ range: "A1", value: null }]],
    ["an object value", [{ range: "A1", value: {} }]],
    ["a list value", [{ range: "A1", value: ["x"] }]],
    ["no value", [{ range: "A1" }]],
    ["an unknown key", [{ range: "A1", value: "x", note: 1 }]],
  ])("refuses %s, before any request", async (_name, guards) => {
    const h = await writeFixture([metadata()])

    await expect(h.edit({ ...EDIT, expect: guards })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("takes a cell with or without a tab, quoted or not, 200 of them, and a number or a boolean", async () => {
    const guards = [
      { range: "Plan!B12", value: "x" },
      { range: "'My Tab'!zz9", value: 3 },
      { range: "A1", value: true },
      ...Array.from({ length: MAX_EXPECT - 3 }, () => ({ range: "C3", value: "" })),
    ]
    const h = await writeFixture([
      metadata(),
      valuesHandler((range) =>
        range === "Plan!B12" ? [["x"]] : range === "'My Tab'!zz9" ? [["3"]] : range === "A1" ? [["TRUE"]] : [],
      ),
      post(UPDATE_URL),
    ])

    await h.edit({ ...EDIT, expect: guards })

    expect(writesOf(h.requests)).toHaveLength(1)
  })
})

describe("expect: the check", () => {
  test("passes when every cell shows what was expected, trimmed, a boolean as TRUE or FALSE and an empty cell as an empty text", async () => {
    const h = await writeFixture([
      metadata(),
      valuesHandler((range) => (range === "Plan!A1" ? [["  Name  "]] : range === "Plan!A2" ? [["TRUE"]] : [])),
      post(UPDATE_URL),
    ])

    await h.edit({
      ...EDIT,
      expect: [
        { range: "Plan!A1", value: "Name" },
        { range: "Plan!A2", value: true },
        { range: "Plan!A3", value: "" },
      ],
    })

    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("refuses as stale, with every difference in details and nothing written", async () => {
    const h = await writeFixture([metadata(), shown({ "Plan!A1": "Total", "Plan!B2": "7" }), post(UPDATE_URL)])

    const error = await toolError(
      h.edit({
        ...EDIT,
        expect: [
          { range: "Plan!A1", value: "Name" },
          { range: "Plan!B2", value: 7 },
          { range: "Plan!C3", value: "id-9" },
        ],
      }),
    )

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      'Nothing was written: the cells the call expected differ (the rows may have moved; read them again): Plan!A1: expected "Name", found "Total"; Plan!C3: expected "id-9", found ""',
    )
    expect(error.details).toEqual({
      differs: [
        { range: "Plan!A1", expected: "Name", found: "Total" },
        { range: "Plan!C3", expected: "id-9", found: "" },
      ],
    })
    expect(writesOf(h.requests)).toEqual([])
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${BATCH_GET_URL}`])
  })

  test("lists five differences in the message, counts the rest, and keeps them all in details, found clipped to 200", async () => {
    const h = await writeFixture([metadata(), valuesHandler(() => [["z".repeat(300)]]), post(UPDATE_URL)])
    const guards = Array.from({ length: 7 }, (_, index) => ({ range: `Plan!A${index + 1}`, value: "x" }))

    const error = await toolError(h.edit({ ...EDIT, expect: guards }))

    expect(error.message).toEndWith("; +2 more")
    expect(error.message.match(/found "/g)).toHaveLength(5)
    expect(error.message).not.toContain("z".repeat(201))
    const differs = error.details!.differs as { found: string }[]
    expect(differs).toHaveLength(7)
    expect(Array.from(differs[0]!.found)).toHaveLength(200)
    expect(differs[0]!.found.endsWith("…")).toBe(true)
  })

  test("a value as long as the cell shows it passes, however long", async () => {
    const long = "q".repeat(500)
    const h = await writeFixture([metadata(), valuesHandler(() => [[long]]), post(UPDATE_URL)])

    await h.edit({ ...EDIT, expect: [{ range: "Plan!A1", value: long }] })

    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("Google answering for another number of ranges is upstream_error, with nothing written", async () => {
    const h = await writeFixture([
      metadata(),
      { method: "GET", url: BATCH_GET_URL, reply: { json: { valueRanges: [{ range: "Plan!A1", values: [["x"]] }] } } },
      post(UPDATE_URL),
    ])

    const error = await toolError(
      h.edit({
        ...EDIT,
        expect: [
          { range: "Plan!A1", value: "x" },
          { range: "Plan!A2", value: "y" },
        ],
      }),
    )

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("unexpected number of ranges")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("guards a clear the same way", async () => {
    const h = await writeFixture([metadata(), shown({ "Plan!A1": "Total" }), post(CLEAR_URL, {})])

    const error = await toolError(
      h.clear({ spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A1:C9"], expect: [{ range: "Plan!A1", value: "Name" }] }),
    )

    expect(error.code).toBe("stale")
    expect(writesOf(h.requests)).toEqual([])
  })
})
