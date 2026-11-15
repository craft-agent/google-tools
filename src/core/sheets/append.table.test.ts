import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { BATCH_UPDATE_URL, ORDERS_TABLE, SPREADSHEET, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const APPEND = { spreadsheet: SPREADSHEET_ID, table: "Orders", values: [["Pens", 3, true]] }

const GREW = { ...ORDERS_TABLE, range: { ...ORDERS_TABLE.range, endRowIndex: 6 } }

/** The spreadsheet with the Orders table changed to `table`. */
const withTable = (table: unknown) => ({
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.map((sheet) => ("tables" in sheet ? { ...sheet, tables: [table] } : sheet)),
})

/** The spreadsheet with `tables` in its second tab, beside the Orders table. */
const withTables = (tables: { tableId: string; name: string }[]) => ({
  ...SPREADSHEET,
  sheets: SPREADSHEET.sheets.map((sheet) =>
    sheet.properties.title === "My Tab"
      ? { ...sheet, tables: tables.map((table) => ({ ...table, range: ORDERS_TABLE.range })) }
      : sheet,
  ),
})

/** Handlers that answer the first read of the spreadsheet with `before` and the one after the write with `after`. */
const appending = (before: unknown = SPREADSHEET, after: unknown = withTable(GREW)) => [
  { ...metadata(before), once: true },
  post(BATCH_UPDATE_URL, { replies: [{}] }),
  metadata(after),
]

describe("google_sheets_append: a table", () => {
  test("appends to the table and returns its range as it grew", async () => {
    const h = await writeFixture(appending())

    expect(await h.append(APPEND)).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      tab: "Plan",
      table: "Orders",
      appended_rows: 1,
      table_range: "Plan!A1:C6",
    })
  })

  test("reads the tabs with their tables, appends in one batch update, and reads them again", async () => {
    const h = await writeFixture(appending())

    await h.append(APPEND)

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${BATCH_UPDATE_URL}`, `GET ${SPREADSHEET_URL}`])
    expect(h.calls()[0]!.url.searchParams.get("fields")).toContain("tables(tableId,name,range)")
    expect(writesOf(h.requests)[0]!.json).toEqual({
      requests: [
        {
          appendCells: {
            sheetId: 0,
            tableId: "tbl-orders-1",
            rows: [
              {
                values: [
                  { userEnteredValue: { stringValue: "Pens" } },
                  { userEnteredValue: { numberValue: 3 } },
                  { userEnteredValue: { boolValue: true } },
                ],
              },
            ],
            fields: "userEnteredValue",
          },
        },
      ],
    })
  })

  test.each([
    ["its id", "tbl-orders-1"],
    ["its exact name", "Orders"],
    ["its name in other letters", "oRDERS"],
  ])("finds the table by %s", async (_name, table) => {
    const h = await writeFixture(appending())

    expect((await h.append({ ...APPEND, table })).table).toBe("Orders")
  })

  test("takes the exact name before a name that differs only in case, and refuses what several tables match", async () => {
    const both = withTables([
      { tableId: "tbl-a", name: "orders" },
      { tableId: "tbl-b", name: "ORDERS" },
    ])
    const h = await writeFixture(appending(both, both))

    expect((await h.append(APPEND)).table).toBe("Orders")
    const error = await toolError(h.append({ ...APPEND, table: "OrdeRS" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Several tables match")
    expect(error.message).toContain("Orders, orders, ORDERS")
  })

  test("a table that does not exist is refused, listing at most 20 table names", async () => {
    const many = withTables(
      Array.from({ length: 25 }, (_, index) => ({ tableId: `t${index}`, name: `Extra ${index}` })),
    )
    const h = await writeFixture(appending(many))

    const error = await toolError(h.append({ ...APPEND, table: "Nope" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('No table matches "Nope"')
    expect(error.message).toContain("Orders, Extra 0")
    expect(error.message).toContain("Extra 18 (+6 more)")
    expect(writesOf(h.requests)).toEqual([])
  })

  test("a spreadsheet with no tables says so", async () => {
    const h = await writeFixture(appending({ ...SPREADSHEET, sheets: [{ properties: { title: "Plan" } }] }))

    await expect(h.append(APPEND)).rejects.toMatchObject({ message: expect.stringContaining("tables are: none") })
  })

  test("a row wider than the table is refused naming its width, and a narrower one is padded by Google", async () => {
    const h = await writeFixture(appending())

    const error = await toolError(h.append({ ...APPEND, values: [["a", "b", "c", "d"]] }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"Orders" has 3 columns, and a row holds 4 cells')
    expect(writesOf(h.requests)).toEqual([])
    await h.append({ ...APPEND, values: [["a"]] })
    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("types each cell: numbers and booleans keep their type, = is a formula, null and empty text leave the cell empty", async () => {
    const wide = withTable({ ...ORDERS_TABLE, range: { ...ORDERS_TABLE.range, endColumnIndex: 8 } })
    const h = await writeFixture(appending(wide))

    await h.append({ ...APPEND, values: [["=SUM(A1:A2)", "2026-01-02", 2.5, false, null, "", "=", "'x"]] })

    const rows = (writesOf(h.requests)[0]!.json as any).requests[0].appendCells.rows
    expect(rows[0].values).toEqual([
      { userEnteredValue: { formulaValue: "=SUM(A1:A2)" } },
      { userEnteredValue: { stringValue: "2026-01-02" } },
      { userEnteredValue: { numberValue: 2.5 } },
      { userEnteredValue: { boolValue: false } },
      {},
      {},
      { userEnteredValue: { formulaValue: "=" } },
      { userEnteredValue: { stringValue: "'x" } },
    ])
  })

  test("raw keeps a formula as text", async () => {
    const h = await writeFixture(appending())

    await h.append({ ...APPEND, values: [["=A1"]], raw: true })

    const rows = (writesOf(h.requests)[0]!.json as any).requests[0].appendCells.rows
    expect(rows[0].values).toEqual([{ userEnteredValue: { stringValue: "=A1" } }])
  })

  test("keeps the rows in when the table cannot be read back, and says which step failed", async () => {
    const failed = {
      method: "GET" as const,
      url: SPREADSHEET_URL,
      reply: { status: 500, json: { error: { code: 500, message: "Backend busy", status: "INTERNAL" } } },
    }
    const h = await writeFixture([{ ...metadata(), once: true }, post(BATCH_UPDATE_URL, {}), failed])

    const result = await h.append(APPEND)

    expect(result).toMatchObject({ table: "Orders", appended_rows: 1, table_range: null })
    expect(result.errors.table_range).toStartWith("upstream_error: ")
  })

  test("a table that is gone after the write has no range", async () => {
    const h = await writeFixture(appending(SPREADSHEET, { ...SPREADSHEET, sheets: [] }))

    expect(await h.append(APPEND)).toMatchObject({ table_range: null })
  })
})
