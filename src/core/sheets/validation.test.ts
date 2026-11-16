import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, VALIDATED, WITH_OBJECTS, refusedCall, sendAdd, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const LIST = { when: "ONE_OF_LIST", values: ["a", "b"] }

describe("google_sheets_add: validate", () => {
  test("sets a rule on each range, after reading the validation of the ranges once", async () => {
    const { h, body, result } = await sendAdd(
      [{ op: "validate", ranges: ["Plan!F2:F50", "'My Tab'!A1:A9"], ...LIST, help: "Pick one" }],
      { spreadsheet: WITH_OBJECTS },
    )

    const rule = {
      condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "a" }, { userEnteredValue: "b" }] },
      strict: true,
      showCustomUi: true,
      inputMessage: "Pick one",
    }
    expect(body.requests).toEqual([
      { setDataValidation: { range: PLAN_GRID(1, 50, 5, 6), rule } },
      { setDataValidation: { range: { ...PLAN_GRID(0, 9, 0, 1), sheetId: 77 }, rule } },
    ])
    expect(result.applied).toEqual(["validate Plan!F2:F50, 'My Tab'!A1:A9 dropdown (a, b), reject other input"])
    const reads = h.calls().filter((call) => call.url.searchParams.has("includeGridData"))
    expect(reads).toHaveLength(1)
    expect(reads[0]!.url.searchParams.getAll("ranges")).toEqual(["Plan!F2:F50", "'My Tab'!A1:A9"])
    expect(reads[0]!.url.searchParams.get("fields")).toBe("sheets.data.rowData.values.dataValidation")
  })

  test("warns instead of rejecting for strict false, shows no dropdown for another condition, and asks for the formula's =", async () => {
    const { body, result } = await sendAdd(
      [
        { op: "validate", range: "Plan!A2:A9", ...LIST, strict: false, dropdown: false },
        { op: "validate", range: "Plan!B2:B9", when: "NUMBER_BETWEEN", values: [1, 10], dropdown: true },
        { op: "validate", range: "Plan!C2:C9", when: "ONE_OF_RANGE", values: ["Lists!A1:A5"] },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    const rules = (body.requests as any[]).map((request) => request.setDataValidation.rule)
    expect(rules.map((rule) => [rule.strict, rule.showCustomUi])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ])
    expect(rules[1].condition).toEqual({
      type: "NUMBER_BETWEEN",
      values: [{ userEnteredValue: "1" }, { userEnteredValue: "10" }],
    })
    expect(rules[2].condition.values).toEqual([{ userEnteredValue: "=Lists!A1:A5" }])
    expect(result.applied).toEqual([
      "validate Plan!A2:A9 dropdown (a, b), warn on other input",
      "validate Plan!B2:B9 NUMBER_BETWEEN 1, 10, reject other input",
      "validate Plan!C2:C9 dropdown from Lists!A1:A5, reject other input",
    ])
  })

  test("refuses a range that has a rule already, naming the operation that replaces it, and sends nothing", async () => {
    const error = await refusedCall("add", [{ op: "validate", range: "Plan!A1:C1", ...LIST }], {
      validation: VALIDATED,
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already has data validation")
    expect(error.message).toContain("google_sheets_restructure's validate_replace")
  })

  test.each([
    ["10,000 cells", "Plan!A1:A10000", true],
    ["10,001 cells", "Plan!A1:A10001", false],
    ["100 by 101 cells", "Plan!A1:CW101", false],
    ["the 100 cells of a column of a tab of 100 rows", "Plan!A:A", true],
    ["the 1,000 cells of a whole tab of 100 rows and 10 columns", "Plan", true],
    ["a column of a tab whose size is not known", "'My Tab'!A:A", false],
  ])("reads the validation of %s: %s", async (_name, range, taken) => {
    const call = [{ op: "validate", range, ...LIST }]
    if (taken) {
      const { body } = await sendAdd(call, { spreadsheet: WITH_OBJECTS })
      expect(body.requests).toHaveLength(1)
      return
    }
    const error = await refusedCall("add", call)
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("more than 10000 cells")
    expect(error.message).toContain("narrow")
  })

  test("counts the cells of all the ranges of an operation together, and reads nothing for a refused call", async () => {
    const error = await refusedCall("add", [{ op: "validate", ranges: ["Plan!A1:A6000", "Plan!B1:B6000"], ...LIST }])

    expect(error.code).toBe("invalid_argument")
  })

  test.each([
    ["a relative date", { when: "DATE_BEFORE", values: ["TODAY"] }, "CUSTOM_FORMULA"],
    ["a dropdown with no options", { when: "ONE_OF_LIST" }, "needs `values`"],
    ["a dropdown from a range with no range", { when: "ONE_OF_RANGE", values: [] }, "needs `values`"],
    ["a condition outside Google's", { when: "BIGGER" }, "when"],
    ["an empty help", { ...LIST, help: " " }, "help"],
  ])("refuses %s, and sends nothing", async (_name, rule, message) => {
    const error = await refusedCall("add", [{ op: "validate", range: "Plan!A2:A9", ...rule }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })
})

describe("google_sheets_restructure: validate_replace and validate_clear", () => {
  test("replaces the rule of ranges that have one, after reading their validation", async () => {
    const { h, body, result } = await sendRestructure(
      [{ op: "validate_replace", range: "Plan!A1:C1", ...LIST, strict: false }],
      { spreadsheet: WITH_OBJECTS, validation: VALIDATED },
    )

    expect(body.requests).toEqual([
      {
        setDataValidation: {
          range: PLAN_GRID(0, 1, 0, 3),
          rule: {
            condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "a" }, { userEnteredValue: "b" }] },
            strict: false,
            showCustomUi: true,
          },
        },
      },
    ])
    expect(result.applied).toEqual(["validate_replace Plan!A1:C1 dropdown (a, b), warn on other input"])
    expect(h.calls().filter((call) => call.url.searchParams.has("includeGridData"))).toHaveLength(1)
  })

  test("sets a rule on ranges that have none, too", async () => {
    const { body } = await sendRestructure([{ op: "validate_replace", range: "Plan!A1:C1", ...LIST }], {
      spreadsheet: WITH_OBJECTS,
    })

    expect(body.requests).toHaveLength(1)
  })

  test("clears the rule of each range, and loses no value", async () => {
    const { body, result } = await sendRestructure(
      [{ op: "validate_clear", ranges: ["Plan!A1:C1", "'My Tab'!B1:B9"] }],
      { spreadsheet: WITH_OBJECTS, validation: VALIDATED },
    )

    expect(body.requests).toEqual([
      { setDataValidation: { range: PLAN_GRID(0, 1, 0, 3) } },
      { setDataValidation: { range: { ...PLAN_GRID(0, 9, 1, 2), sheetId: 77 } } },
    ])
    expect(result.applied).toEqual(["validate_clear Plan!A1:C1, 'My Tab'!B1:B9"])
    expect(result.before).toEqual([])
  })

  test("takes at most 10,000 cells in a range, and a rule that is well formed", async () => {
    for (const operation of [
      { op: "validate_clear", range: "Plan!A1:A10001" },
      { op: "validate_replace", range: "Plan!A1:A10001", ...LIST },
    ]) {
      const error = await refusedCall("restructure", [operation])
      expect(error.message).toContain("more than 10000 cells")
    }
    const error = await refusedCall("restructure", [{ op: "validate_replace", range: "Plan!A1", when: "ONE_OF_LIST" }])
    expect(error.code).toBe("invalid_argument")
  })
})
