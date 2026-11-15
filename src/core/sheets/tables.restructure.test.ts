import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS, refusedCall, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const red = { rgbColor: { red: 1, green: 0, blue: 0 } }

describe("google_sheets_restructure: table_update", () => {
  test("changes only what is given: the range, the name and the colors, with a field mask that names them", async () => {
    const { body, result } = await sendRestructure(
      [{ op: "table_update", table: "tbl-orders-1", range: "Plan!A1:C9", name: "Sales", header_color: "#ff0000" }],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        updateTable: {
          table: {
            tableId: "tbl-orders-1",
            range: PLAN_GRID(0, 9, 0, 3),
            name: "Sales",
            rowsProperties: { headerColorStyle: red },
          },
          fields: "range,name,rowsProperties.headerColorStyle",
        },
      },
    ])
    expect(result.applied).toEqual(['table_update "Orders": rename to "Sales", range Plan!A1:C9, header #ff0000'])
  })

  test("finds the table by its exact name, then ignoring case, and sends the columns with the existing ones kept", async () => {
    const { body } = await sendRestructure(
      [
        {
          op: "table_update",
          table: "ORDERS",
          table_columns: [
            { column: "B", type: "PERCENT" },
            { column: "A", name: "Thing" },
          ],
        },
        { op: "table_update", table: "Costs", table_columns: [{ column: "F", type: "TEXT", name: "Total" }] },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        updateTable: {
          table: {
            tableId: "tbl-orders-1",
            columnProperties: [
              { columnIndex: 0, columnName: "Thing", columnType: "TEXT" },
              { columnIndex: 1, columnName: "Qty", columnType: "PERCENT" },
              {
                columnIndex: 2,
                columnName: "Status",
                columnType: "DROPDOWN",
                dataValidationRule: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "open" }] } },
              },
            ],
          },
          fields: "columnProperties",
        },
      },
      {
        updateTable: {
          table: {
            tableId: "tbl-costs-2",
            columnProperties: [{ columnIndex: 1, columnType: "TEXT", columnName: "Total" }],
          },
          fields: "columnProperties",
        },
      },
    ])
  })

  test("drops a column's dropdown options when its type is no longer DROPDOWN, and re-bases the columns when the table moves", async () => {
    const { body } = await sendRestructure(
      [{ op: "table_update", table: "Orders", range: "B1:D5", table_columns: [{ column: "C", type: "TEXT" }] }],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        updateTable: {
          table: {
            tableId: "tbl-orders-1",
            range: PLAN_GRID(0, 5, 1, 4),
            columnProperties: [
              { columnIndex: 0, columnName: "Qty", columnType: "DOUBLE" },
              { columnIndex: 1, columnName: "Status", columnType: "TEXT" },
            ],
          },
          fields: "range,columnProperties",
        },
      },
    ])
  })

  test("keeps a range with no tab on the table's own tab, and names both tabs when it moves to another", async () => {
    const own = await sendRestructure([{ op: "table_update", table: "Costs", range: "E1:F9" }], {
      spreadsheet: WITH_OBJECTS,
    })
    expect(own.body.requests).toEqual([
      { updateTable: { table: { tableId: "tbl-costs-2", range: PLAN_GRID(0, 9, 4, 6) }, fields: "range" } },
    ])

    const moved = await sendRestructure([{ op: "table_update", table: "Costs", range: "'My Tab'!A1:B4" }], {
      spreadsheet: WITH_OBJECTS,
    })
    expect(moved.result.tabs).toEqual(["Plan", "My Tab"])
  })

  test.each([
    ["an unknown table", { table: "Nope", name: "X" }, 'No table matches "Nope"'],
    ["a table by a partial name", { table: "Ord", name: "X" }, "No table matches"],
    ["no change", { table: "Orders" }, "Give `range`"],
    ["a range that overlaps another table", { table: "Orders", range: "Plan!A1:F5" }, 'overlaps the table "Costs"'],
    [
      "a column outside the table",
      { table: "Orders", table_columns: [{ column: "D", type: "TEXT" }] },
      'outside table "Orders"',
    ],
    ["a range with an open end", { table: "Orders", range: "A1:C" }, "closed block"],
  ])("refuses %s, and sends nothing", async (_name, op, message) => {
    const error = await refusedCall("restructure", [{ op: "table_update", ...op }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("lists the spreadsheet's tables when none matches", async () => {
    const error = await refusedCall("restructure", [{ op: "table_update", table: "Nope", name: "X" }])

    expect(error.message).toContain("Orders, Costs")
  })

  test("plans a later operation on the name an earlier one gave the table, and refuses a table the call deleted", async () => {
    const { body } = await sendRestructure(
      [
        { op: "table_update", table: "Orders", name: "Sales" },
        { op: "table_update", table: "sales", header_color: "#fff" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )
    expect(body.requests).toHaveLength(2)

    const error = await refusedCall("restructure", [
      { op: "table_delete", table: "Orders" },
      { op: "table_update", table: "tbl-orders-1", name: "X" },
    ])
    expect(error.code).toBe("invalid_argument")
  })
})

describe("google_sheets_restructure: table_delete", () => {
  test("deletes a table by id, or by name, and says that its cells keep their values", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "table_delete", table: "tbl-orders-1" },
        { op: "table_delete", table: "costs" },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      { deleteTable: { tableId: "tbl-orders-1" } },
      { deleteTable: { tableId: "tbl-costs-2" } },
    ])
    expect(result.applied).toEqual([
      'table_delete "Orders" (Plan!A1:C5): only the table goes, its cells keep their values',
      'table_delete "Costs" (Plan!E1:F4): only the table goes, its cells keep their values',
    ])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("refuses an unknown table, and a table already deleted by the call", async () => {
    expect((await refusedCall("restructure", [{ op: "table_delete", table: "Nope" }])).code).toBe("invalid_argument")
    const twice = await refusedCall("restructure", [
      { op: "table_delete", table: "Orders" },
      { op: "table_delete", table: "Orders" },
    ])
    expect(twice.message).toContain('No table matches "Orders"')
  })
})
