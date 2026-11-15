import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { PIN_PATTERN } from "../pin"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { VALIDATED, WITH_OBJECTS, spreadsheetHandler } from "./structure.testing"
import { BATCH_UPDATE_URL, post, valuesHandler, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The tab `Plan` of `WITH_OBJECTS`, whose lists the cases below change. */
type Plan = Record<string, any>

/** `WITH_OBJECTS` with the tab `Plan` changed by `change`. */
const changed = (change: (plan: Plan) => object) => ({
  ...WITH_OBJECTS,
  sheets: WITH_OBJECTS.sheets.map((sheet) =>
    sheet.properties.title === "Plan" ? { ...sheet, ...change(sheet as Plan) } : sheet,
  ),
})

const handlers = (spreadsheet: unknown, validation: unknown) => [
  spreadsheetHandler(spreadsheet, validation),
  valuesHandler(() => []),
  post(BATCH_UPDATE_URL),
]

/** The description of one call of `google_sheets_restructure`, planned on `spreadsheet`, with `validation` answered to the read of grid data. */
async function describeOn(operations: unknown[], spreadsheet: unknown = WITH_OBJECTS, validation: unknown = {}) {
  const h = await writeFixture(handlers(spreadsheet, validation))
  const args = googleSheetsRestructure.input.parse({ spreadsheet: SPREADSHEET_ID, operations })
  return { h, description: await googleSheetsRestructure.describe!(args, h.ctx) }
}

const OTHER_VALIDATION = {
  sheets: [
    { data: [{ rowData: [{ values: [{ dataValidation: { condition: { type: "BLANK" }, strict: false } }] }] }] },
  ],
}

describe("google_sheets_restructure: the pins of the objects an operation changes", () => {
  test.each([
    [
      "a table updated",
      [{ op: "table_update", table: "tbl-orders-1", name: "Sales" }],
      (plan: Plan) => ({ tables: [plan.tables[0], { ...plan.tables[1], name: "Elsewhere" }] }),
      (plan: Plan) => ({
        tables: [{ ...plan.tables[0], range: { ...plan.tables[0].range, endRowIndex: 9 } }, plan.tables[1]],
      }),
    ],
    [
      "a table deleted",
      [{ op: "table_delete", table: "Costs" }],
      (plan: Plan) => ({ tables: [{ ...plan.tables[0], name: "Orders 2" }, plan.tables[1]] }),
      (plan: Plan) => ({
        tables: [plan.tables[0], { ...plan.tables[1], name: "Costs", columnProperties: [{ columnName: "A" }] }],
      }),
    ],
    [
      "a rule replaced",
      [{ op: "conditional_update", index: 0, range: "Plan!B2:B9", when: "BLANK", bold: true }],
      (plan: Plan) => ({
        conditionalFormats: [...plan.conditionalFormats.slice(0, 2), { ...plan.conditionalFormats[2], ranges: [] }],
      }),
      (plan: Plan) => ({
        conditionalFormats: [
          {
            ...plan.conditionalFormats[0],
            booleanRule: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "6" }] } },
          },
          ...plan.conditionalFormats.slice(1),
        ],
      }),
    ],
    [
      "a rule deleted",
      [{ op: "conditional_delete", index: 1 }],
      (plan: Plan) => ({
        conditionalFormats: [{ ...plan.conditionalFormats[0], ranges: [] }, ...plan.conditionalFormats.slice(1)],
      }),
      (plan: Plan) => ({
        conditionalFormats: [
          plan.conditionalFormats[0],
          { ...plan.conditionalFormats[1], gradientRule: { minpoint: { colorStyle: { themeColor: "ACCENT2" } } } },
          plan.conditionalFormats[2],
        ],
      }),
    ],
    [
      "the filter replaced",
      [{ op: "filter_replace", range: "Plan!A1:F9" }],
      (plan: Plan) => ({ filterViews: [{ ...plan.filterViews[0], title: "Other" }, plan.filterViews[1]] }),
      (plan: Plan) => ({ basicFilter: { ...plan.basicFilter, filterSpecs: [] } }),
    ],
    [
      "the filter cleared",
      [{ op: "filter_clear" }],
      (plan: Plan) => ({ filterViews: [{ ...plan.filterViews[0], title: "Other" }, plan.filterViews[1]] }),
      (plan: Plan) => ({ basicFilter: { range: plan.basicFilter.range } }),
    ],
    [
      "a view updated",
      [{ op: "filter_view_update", view: 9001, name: "Done" }],
      (plan: Plan) => ({ filterViews: [plan.filterViews[0], { ...plan.filterViews[1], title: "Elsewhere" }] }),
      (plan: Plan) => ({ filterViews: [{ ...plan.filterViews[0], title: "Open now" }, plan.filterViews[1]] }),
    ],
    [
      "a view deleted",
      [{ op: "filter_view_delete", view: "Mine" }],
      (plan: Plan) => ({ filterViews: [{ ...plan.filterViews[0], title: "Other" }, plan.filterViews[1]] }),
      (plan: Plan) => ({ filterViews: [plan.filterViews[0], { ...plan.filterViews[1], range: {} }] }),
    ],
  ])(
    "pin %s as it is, so that it changes with the object and with nothing else",
    async (_name, operations, other, changes) => {
      const base = (await describeOn(operations)).description
      const same = (await describeOn(operations, changed(other))).description
      const different = (await describeOn(operations, changed(changes))).description

      expect(base.pins!.objects).toMatch(PIN_PATTERN)
      expect(same.pins).toEqual(base.pins!)
      expect(different.pins!.objects).not.toBe(base.pins!.objects)
      expect(different.pins!.values).toBe(base.pins!.values)
    },
  )

  test("pins the validation of the ranges, so that a rule that appears or changes after the prompt is stale", async () => {
    const operations = [{ op: "validate_replace", range: "Plan!A1:C1", when: "BLANK" }]
    const none = (await describeOn(operations)).description
    const set = (await describeOn(operations, WITH_OBJECTS, VALIDATED)).description
    const again = (await describeOn(operations, WITH_OBJECTS, VALIDATED)).description
    const other = (await describeOn(operations, WITH_OBJECTS, OTHER_VALIDATION)).description

    expect(none.pins!.objects).toMatch(PIN_PATTERN)
    expect(set.pins!.objects).not.toBe(none.pins!.objects)
    expect(again.pins).toEqual(set.pins!)
    expect(other.pins!.objects).not.toBe(set.pins!.objects)

    const cleared = (await describeOn([{ op: "validate_clear", range: "Plan!A1:C1" }], WITH_OBJECTS, VALIDATED))
      .description
    expect(cleared.pins!.objects).toMatch(PIN_PATTERN)
  })

  test("pins nothing of the objects for a call that changes none, or that sets a filter where there was none", async () => {
    const delete_ = (await describeOn([{ op: "delete", range: "Plan!2:3" }])).description
    const fresh = (await describeOn([{ op: "filter_replace", range: "'My Tab'!A1:C9" }])).description

    expect(Object.keys(delete_.pins!)).toEqual(["values"])
    expect(Object.keys(fresh.pins!)).toEqual(["values"])
  })

  test("counts no overwritten cell and reads no value, for operations that lose none", async () => {
    const { h, description } = await describeOn([
      { op: "table_delete", table: "Orders" },
      { op: "conditional_delete", index: 0 },
      { op: "validate_clear", range: "Plan!A1:C1" },
      { op: "filter_clear" },
      { op: "filter_view_delete", view: 9001 },
    ])

    expect(description.facts[0]).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 0 } },
    })
    expect(description.facts[3]).toEqual({
      label: "Operations",
      value: { text: "{count} operations", values: { count: 5 } },
    })
    expect(h.calls().some((call) => call.url.pathname.endsWith("/values:batchGet"))).toBe(false)
    expect(description.text!.body.split("\n")).toEqual([
      'table_delete "Orders" (Plan!A1:C5): only the table goes, its cells keep their values',
      "conditional_delete #0 of Plan (now NUMBER_GREATER 5)",
      "validate_clear Plan!A1:C1",
      "filter_clear Plan",
      'filter_view_delete "Open" (Plan!A1:F50)',
    ])
  })

  test("is accepted by the description check, and throws where the call would refuse", async () => {
    const h = await writeFixture(handlers(WITH_OBJECTS, {}))
    const call = (operation: object) => ({ spreadsheet: SPREADSHEET_ID, operations: [operation] })

    const answer = await callDescription(googleSheetsRestructure, call({ op: "filter_clear" }), h.ctx)
    expect(answer?.pins?.objects).toMatch(PIN_PATTERN)

    for (const operation of [
      { op: "conditional_delete", index: 9 },
      { op: "table_delete", table: "Nope" },
      { op: "filter_view_delete", view: "Nope" },
      { op: "filter_clear", tab: "My Tab" },
    ]) {
      expect(await callDescription(googleSheetsRestructure, call(operation), h.ctx)).toBeUndefined()
    }
  })
})

describe("google_sheets_add and google_sheets_restructure: a label that cannot write", () => {
  test.each([
    ["add", { op: "table", range: "Plan!A10:C20" }],
    ["add", { op: "validate", range: "Plan!A2:A9", when: "BLANK" }],
    ["restructure", { op: "table_delete", table: "Orders" }],
    ["restructure", { op: "validate_clear", range: "Plan!A2:A9" }],
    ["restructure", { op: "filter_view_delete", view: 9001 }],
  ] as const)("%s fails before any request for %j", async (tool, operation) => {
    const h = await writeFixture(handlers(WITH_OBJECTS, {}), SHEETS_CREDENTIAL)

    const error = await toolError(h[tool]({ spreadsheet: SPREADSHEET_ID, operations: [operation] }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
    expect(writesOf(h.requests)).toEqual([])
  })
})
