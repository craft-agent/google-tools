import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BATCH_GET_URL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { UPDATE_URL, metadata, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const EDIT = {
  spreadsheet: SPREADSHEET_ID,
  data: [
    {
      range: "Plan!A1:B2",
      values: [
        ["Name", "Qty"],
        ["Pens", 3],
      ],
    },
  ],
}

const UPDATED = {
  totalUpdatedCells: 4,
  responses: [{ updatedRange: "Plan!A1:B2", updatedRows: 2, updatedColumns: 2, updatedCells: 4 }],
}

const CURRENT = [
  ["Old", "1"],
  ["x", "=A1"],
]

/** Handlers for an edit: the metadata, the current values (as formulas) and an answer to the write. */
const handlers = (current: unknown[][] = CURRENT) => [
  metadata(),
  valuesHandler(() => current),
  post(UPDATE_URL, UPDATED),
]

describe("google_sheets_edit", () => {
  test("returns what Google wrote for each range, and the cells as they were, formulas as written", async () => {
    const h = await writeFixture(handlers())

    expect(await h.edit(EDIT)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      updated: [{ range: "Plan!A1:B2", rows: 2, columns: 2, cells: 4 }],
      updated_cells: 4,
      before: [{ range: "Plan!A1:B2", values: CURRENT }],
      before_truncated: false,
    })
  })

  test("reads the metadata, then the before, then writes, and checks the expected cells in between when it has any", async () => {
    const h = await writeFixture(handlers())

    await h.edit(EDIT)
    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${BATCH_GET_URL}`, `POST ${UPDATE_URL}`])
    expect(h.calls()[1]!.url.searchParams.get("valueRenderOption")).toBe("FORMULA")
    expect(h.calls()[1]!.url.searchParams.getAll("ranges")).toEqual(["Plan!A1:B2"])

    const guarded = await writeFixture(handlers())
    await guarded.edit({ ...EDIT, expect: [{ range: "Plan!A1", value: "Old" }] })
    expect(guarded.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${UPDATE_URL}`,
    ])
    const renders = guarded.calls().map((call) => call.url.searchParams.get("valueRenderOption"))
    expect(renders).toEqual([null, "FORMATTED_VALUE", "FORMULA", null])
  })

  test("sends the data as given, read as typed into the sheet, with no values back", async () => {
    const h = await writeFixture(handlers())

    await h.edit(EDIT)

    expect(writesOf(h.requests)).toHaveLength(1)
    expect(writesOf(h.requests)[0]!.json).toEqual({
      valueInputOption: "USER_ENTERED",
      data: EDIT.data,
      includeValuesInResponse: false,
    })
  })

  test("raw stores the values as given", async () => {
    const h = await writeFixture(handlers())

    await h.edit({ ...EDIT, raw: true })

    expect(writesOf(h.requests)[0]!.json).toMatchObject({ valueInputOption: "RAW" })
  })

  test("sums the cells when Google gives no total, and counts nothing for a reply that says nothing", async () => {
    const h = await writeFixture([
      metadata(),
      valuesHandler(() => []),
      post(UPDATE_URL, { responses: [{ updatedCells: 4 }, { updatedCells: 2 }] }),
    ])

    const result = await h.edit({ ...EDIT, data: [...EDIT.data, { range: "My Tab!A1", values: [[1, 2]] }] })

    expect(result.updated_cells).toBe(6)
    expect(result.updated[0]).toEqual({ range: "", rows: 0, columns: 0, cells: 4 })

    const silent = await writeFixture([metadata(), valuesHandler(() => []), post(UPDATE_URL)])
    expect(await silent.edit(EDIT)).toMatchObject({ updated: [], updated_cells: 0 })
  })

  test("a range that was empty gives back an empty range, and an empty row inside one gives back a cell to clear it", async () => {
    const h = await writeFixture(handlers([["a"], [], ["b"]]))

    const result = await h.edit(EDIT)

    expect(result.before).toEqual([{ range: "Plan!A1:B2", values: [["a"], [""], ["b"]] }])
    const empty = await (await writeFixture(handlers([]))).edit(EDIT)
    expect(empty.before).toEqual([{ range: "Plan!A1:B2", values: [] }])
  })

  test("gives no before when the ranges hold more cells than a read returns, and still writes", async () => {
    const rows = Array.from({ length: 10_001 }, () => ["x"])
    const h = await writeFixture(handlers(rows))

    const result = await h.edit(EDIT)

    expect(result).toMatchObject({ before: null, before_truncated: true, updated_cells: 4 })
    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("gives exactly 10000 cells back, and no before for a text a read would clip", async () => {
    const whole = await (await writeFixture(handlers(Array.from({ length: 10_000 }, () => ["x"])))).edit(EDIT)
    expect(whole.before_truncated).toBe(false)
    expect(whole.before).toHaveLength(1)

    const clipped = await (await writeFixture(handlers([["y".repeat(2_001)]]))).edit(EDIT)
    expect(clipped).toMatchObject({ before: null, before_truncated: true })
  })

  test("the tab of a write is resolved case-insensitively, and the first tab holds a range with no tab", async () => {
    const h = await writeFixture(handlers())

    await h.edit({
      ...EDIT,
      data: [
        { range: "plan!A1", values: [[1]] },
        { range: "B2", values: [[2]] },
      ],
    })

    expect(writesOf(h.requests)).toHaveLength(1)
  })
})
