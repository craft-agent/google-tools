import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeTargets } from "../targets"
import { googleSheetsAdd } from "./add"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { refusedCall, sendAdd } from "./structure.testing"
import { BATCH_UPDATE_URL, metadata, post, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}`

const create = (developerMetadata: object) => ({ createDeveloperMetadata: { developerMetadata } })

describe("google_sheets_add: metadata", () => {
  test("marks the spreadsheet, a tab, one row and one column, each as document metadata unless told otherwise", async () => {
    const { body } = await sendAdd([
      { op: "metadata", key: "owner", value: "finance", on: "spreadsheet" },
      { op: "metadata", key: "stage", on: { tab: "my tab" }, visibility: "project" },
      { op: "metadata", key: "order", value: "A-100", on: { range: "Plan!5:5" } },
      { op: "metadata", key: "region", value: "east", on: { range: "'My Tab'!C:C" } },
    ])

    expect(body.requests).toEqual([
      create({
        metadataKey: "owner",
        metadataValue: "finance",
        location: { spreadsheet: true },
        visibility: "DOCUMENT",
      }),
      create({ metadataKey: "stage", location: { sheetId: 77 }, visibility: "PROJECT" }),
      create({
        metadataKey: "order",
        metadataValue: "A-100",
        location: { dimensionRange: { sheetId: 0, dimension: "ROWS", startIndex: 4, endIndex: 5 } },
        visibility: "DOCUMENT",
      }),
      create({
        metadataKey: "region",
        metadataValue: "east",
        location: { dimensionRange: { sheetId: 77, dimension: "COLUMNS", startIndex: 2, endIndex: 3 } },
        visibility: "DOCUMENT",
      }),
    ])
  })

  test("sends no value for an empty one, and takes a range on the first tab without its title", async () => {
    const { body } = await sendAdd([{ op: "metadata", key: "flag", value: "", on: { range: "3:3" } }])

    expect(body.requests).toEqual([
      create({
        metadataKey: "flag",
        location: { dimensionRange: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 3 } },
        visibility: "DOCUMENT",
      }),
    ])
  })

  test("lists the ids Google gave, in the order of the operations, beside the other results", async () => {
    const { result } = await sendAdd(
      [
        { op: "metadata", key: "a", on: "spreadsheet" },
        { op: "insert", range: "Plan!2:2" },
        { op: "metadata", key: "b", on: { tab: "Plan" } },
      ],
      {
        reply: {
          replies: [
            { createDeveloperMetadata: { developerMetadata: { metadataId: 11, metadataKey: "a" } } },
            {},
            { createDeveloperMetadata: { developerMetadata: { metadataId: 12, metadataKey: "b" } } },
          ],
        },
      },
    )

    expect(result.metadata).toEqual([
      { metadata_id: 11, key: "a" },
      { metadata_id: 12, key: "b" },
    ])
    expect(result.tabs).toEqual(["Plan"])
    expect(result.requests).toBe(3)
  })

  test("says what it adds and where, quoting the key and the value", async () => {
    const { result } = await sendAdd([
      { op: "metadata", key: "owner", value: "x".repeat(60), on: "spreadsheet" },
      { op: "metadata", key: "stage", on: { tab: "My Tab" }, visibility: "project" },
      { op: "metadata", key: "order", value: "A-1", on: { range: "Plan!5:5" } },
      { op: "metadata", key: "region", on: { range: "a/b!C:C" } },
    ])

    expect(result.applied).toEqual([
      `metadata "owner"="${"x".repeat(39)}…" on the spreadsheet`,
      "metadata \"stage\" (project only) on tab 'My Tab'",
      'metadata "order"="A-1" on rows Plan!5:5',
      "metadata \"region\" on columns 'a/b'!C:C",
    ])
  })

  test.each([
    ["a block", { range: "Plan!A1:B2" }],
    ["the whole tab as a range", { range: "Plan" }],
    ["a block of rows and columns", { range: "Plan!A1:C" }],
    ["a tab the spreadsheet lacks", { range: "Nope!5:5" }],
    ["a tab it lacks by title", { tab: "Nope" }],
  ])("refuses %s, before any write", async (_name, on) => {
    const error = await refusedCall("add", [{ op: "metadata", key: "k", on }])

    expect(error.code).toBe("invalid_argument")
  })

  test("refuses rows or columns that are not one, since Google marks one at a time", async () => {
    const rows = await refusedCall("add", [{ op: "metadata", key: "k", on: { range: "Plan!5:7" } }])
    const columns = await refusedCall("add", [{ op: "metadata", key: "k", on: { range: "Plan!B:D" } }])

    expect(rows.message).toContain('"Plan!5:7" spans 3 rows; Google attaches metadata to exactly one row')
    expect(columns.message).toContain('"Plan!B:D" spans 3 columns; Google attaches metadata to exactly one column')
  })

  test.each([
    ["no key", { on: "spreadsheet" }],
    ["an empty key", { key: "", on: "spreadsheet" }],
    ["a key of 101 characters", { key: "k".repeat(101), on: "spreadsheet" }],
    ["a value of 2001 characters", { key: "k", value: "v".repeat(2001), on: "spreadsheet" }],
    ["no place", { key: "k" }],
    ["a place that is not one", { key: "k", on: "sheet" }],
    ["a tab and a range", { key: "k", on: { tab: "Plan", range: "Plan!5:5" } }],
    ["a visibility Google lacks", { key: "k", visibility: "private", on: "spreadsheet" }],
    ["an unknown argument", { key: "k", on: "spreadsheet", note: 1 }],
  ])("refuses %s, before any request", async (_name, operation) => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])

    await expect(
      h.add({ spreadsheet: SPREADSHEET_ID, operations: [{ op: "metadata", ...operation }] }),
    ).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(h.requests).toEqual([])
  })

  test("accepts a key and a value at their limits", async () => {
    const { body } = await sendAdd([
      { op: "metadata", key: "k".repeat(100), value: "v".repeat(2000), on: "spreadsheet" },
    ])

    expect(body.requests).toHaveLength(1)
  })
})

describe("google_sheets_add: metadata targets and prompt", () => {
  const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

  test("names the tab of a tab, row or column mark and the spreadsheet for the spreadsheet's own", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])
    const targets = (...operations: unknown[]) => writeTargets(googleSheetsAdd, call(...operations), h.ctx)

    expect(await targets({ op: "metadata", key: "k", on: { tab: "My Tab" } })).toEqual([`${BASE}/sheets/77`])
    expect(await targets({ op: "metadata", key: "k", on: { range: "Plan!5:5" } })).toEqual([`${BASE}/sheets/0`])
    expect(await targets({ op: "metadata", key: "k", on: "spreadsheet" })).toEqual([BASE])
    expect(
      await targets(
        { op: "metadata", key: "k", on: "spreadsheet" },
        { op: "metadata", key: "k", on: { range: "a/b!A:A" } },
      ),
    ).toEqual([BASE, `${BASE}/sheets/5`])
    expect(await targets({ op: "metadata", key: "k", on: { range: "Plan!5:7" } })).toEqual(["*"])
  })

  test("describes a mark on a tab as an addition to that tab, and one on the spreadsheet as one to the spreadsheet", async () => {
    const h = await writeFixture([metadata(), post(BATCH_UPDATE_URL)])
    const describeCall = (...operations: unknown[]) =>
      googleSheetsAdd.describe!(googleSheetsAdd.input.parse(call(...operations)), h.ctx)

    expect((await describeCall({ op: "metadata", key: "k", on: { range: "Plan!5:5" } })).headline).toEqual({
      text: "About to add to {tab} in {spreadsheet}",
      values: { tab: "Plan", spreadsheet: "Budget 2027" },
    })
    expect((await describeCall({ op: "metadata", key: "k", on: "spreadsheet" })).headline).toEqual({
      text: "About to add to {spreadsheet}",
      values: { spreadsheet: "Budget 2027" },
    })
  })
})
