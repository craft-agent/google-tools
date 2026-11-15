import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS, refusedCall, sendAdd, sendRestructure } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const rgb = (red: number, green: number, blue: number) => ({ rgbColor: { red, green, blue } })

describe("google_sheets_add: conditional", () => {
  test("adds a rule with a condition and a style as the tab's first rule", async () => {
    const { body, result } = await sendAdd(
      [
        {
          op: "conditional",
          ranges: ["Plan!B2:B50", "Plan!E:E"],
          when: "NUMBER_GREATER",
          values: [10],
          bold: true,
          strikethrough: false,
          color: "#ff0000",
          background: "#fee",
        },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [PLAN_GRID(1, 50, 1, 2), { sheetId: 0, startColumnIndex: 4, endColumnIndex: 5 }],
            booleanRule: {
              condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "10" }] },
              format: {
                textFormat: { bold: true, strikethrough: false, foregroundColorStyle: rgb(1, 0, 0) },
                backgroundColorStyle: rgb(1, 238 / 255, 238 / 255),
              },
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual([
      "conditional Plan!B2:B50, Plan!E:E when NUMBER_GREATER 10: bold, no strikethrough, color #ff0000, background #ffeeee",
    ])
    expect(result.tabs).toEqual(["Plan"])
  })

  test("names a relative date for a date condition, and puts a formula's leading = where it is missing", async () => {
    const { body } = await sendAdd(
      [
        { op: "conditional", range: "Plan!A2:A9", when: "DATE_BEFORE", values: ["today"], italic: true },
        { op: "conditional", range: "Plan!B2:B9", when: "CUSTOM_FORMULA", values: ["B2>A2"], bold: true },
        { op: "conditional", range: "Plan!C2:C9", when: "NOT_BLANK", bold: true },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    const conditions = (body.requests as any[]).map(
      (request) => request.addConditionalFormatRule.rule.booleanRule.condition,
    )
    expect(conditions).toEqual([
      { type: "DATE_BEFORE", values: [{ relativeDate: "TODAY" }] },
      { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=B2>A2" }] },
      { type: "NOT_BLANK" },
    ])
  })

  test("adds a color scale of two colors, or of three with the middle one at the median", async () => {
    const { body, result } = await sendAdd(
      [
        { op: "conditional", range: "Plan!B2:B50", scale: ["#ffffff", "#ff0000"] },
        { op: "conditional", range: "Plan!C2:C50", scale: ["#ff0000", "#ffff00", "theme:ACCENT1"] },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [PLAN_GRID(1, 50, 1, 2)],
            gradientRule: {
              minpoint: { colorStyle: rgb(1, 1, 1), type: "MIN" },
              maxpoint: { colorStyle: rgb(1, 0, 0), type: "MAX" },
            },
          },
        },
      },
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [PLAN_GRID(1, 50, 2, 3)],
            gradientRule: {
              minpoint: { colorStyle: rgb(1, 0, 0), type: "MIN" },
              midpoint: { colorStyle: rgb(1, 1, 0), type: "PERCENTILE", value: "50" },
              maxpoint: { colorStyle: { themeColor: "ACCENT1" }, type: "MAX" },
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual([
      "conditional Plan!B2:B50 color scale #ffffff > #ff0000",
      "conditional Plan!C2:C50 color scale #ff0000 > #ffff00 > theme:ACCENT1",
    ])
  })

  test.each([
    ["a condition with no style", { when: "BLANK" }, "Give `when` with at least one style"],
    ["a style with no condition", { bold: true }, "Give `when` with at least one style"],
    ["a scale with a condition", { scale: ["#fff", "#000"], when: "BLANK" }, "Give `when` with at least one style"],
    ["a scale with a style", { scale: ["#fff", "#000"], bold: true }, "Give `when` with at least one style"],
    ["a scale of one color", { scale: ["#fff"] }, "scale"],
    ["a scale of four colors", { scale: ["#fff", "#eee", "#ddd", "#ccc"] }, "scale"],
    ["a condition outside Google's", { when: "BIGGER", bold: true }, "when"],
  ])("refuses %s, and sends nothing", async (_name, rule, message) => {
    const error = await refusedCall("add", [{ op: "conditional", range: "Plan!B2:B9", ...rule }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("refuses ranges on two tabs, one rule being on one tab", async () => {
    const error = await refusedCall("add", [
      { op: "conditional", ranges: ["Plan!B2:B9", "'My Tab'!B2:B9"], when: "BLANK", bold: true },
    ])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must lie on one tab")
  })
})

describe("google_sheets_restructure: conditional_update and conditional_delete", () => {
  test("replaces the rule at a number, naming what the rule says now", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "conditional_update", index: 0, range: "Plan!B2:B9", when: "TEXT_EQ", values: ["x"], bold: true },
        { op: "conditional_update", index: 1, range: "Plan!C2:C9", scale: ["#fff", "#000"] },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      {
        updateConditionalFormatRule: {
          sheetId: 0,
          index: 0,
          rule: {
            ranges: [PLAN_GRID(1, 9, 1, 2)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "x" }] },
              format: { textFormat: { bold: true } },
            },
          },
        },
      },
      {
        updateConditionalFormatRule: {
          sheetId: 0,
          index: 1,
          rule: {
            ranges: [PLAN_GRID(1, 9, 2, 3)],
            gradientRule: {
              minpoint: { colorStyle: rgb(1, 1, 1), type: "MIN" },
              maxpoint: { colorStyle: rgb(0, 0, 0), type: "MAX" },
            },
          },
        },
      },
    ])
    expect(result.applied).toEqual([
      "conditional_update #0 of Plan (now NUMBER_GREATER 5) to Plan!B2:B9 when TEXT_EQ x: bold",
      "conditional_update #1 of Plan (now color scale) to Plan!C2:C9 color scale #ffffff > #000000",
    ])
  })

  test("deletes the rule at a number, and says which rule it is", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "conditional_delete", index: 2, tab: "plan" },
        { op: "conditional_delete", index: 1 },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests).toEqual([
      { deleteConditionalFormatRule: { sheetId: 0, index: 2 } },
      { deleteConditionalFormatRule: { sheetId: 0, index: 1 } },
    ])
    expect(result.applied).toEqual([
      "conditional_delete #2 of Plan (now TEXT_CONTAINS late)",
      "conditional_delete #1 of Plan (now color scale)",
    ])
  })

  test("applies the operations on a tab's rules in order, each counting the rules as the earlier ones leave them", async () => {
    const { body, result } = await sendRestructure(
      [
        { op: "conditional_delete", index: 0 },
        { op: "conditional_delete", index: 0 },
        { op: "conditional_update", index: 0, range: "Plan!D2:D9", when: "BLANK", bold: true },
      ],
      { spreadsheet: WITH_OBJECTS },
    )

    expect(body.requests.map((request: any) => Object.keys(request)[0])).toEqual([
      "deleteConditionalFormatRule",
      "deleteConditionalFormatRule",
      "updateConditionalFormatRule",
    ])
    expect(result.applied).toEqual([
      "conditional_delete #0 of Plan (now NUMBER_GREATER 5)",
      "conditional_delete #0 of Plan (now color scale)",
      "conditional_update #0 of Plan (now TEXT_CONTAINS late) to Plan!D2:D9 when BLANK: bold",
    ])
  })

  test.each([
    ["a third delete of the rule 0 of three", [0, 0, 0, 0]],
    ["the number 3 of three rules", [3]],
    ["the number 2 after one delete", [0, 2]],
  ])("refuses %s, saying how many rules the tab has", async (_name, indexes) => {
    const error = await refusedCall(
      "restructure",
      indexes.map((index) => ({ op: "conditional_delete", index })),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toMatch(/"Plan" has (no|\d+) conditional rules?, numbered from 0; there is no rule #\d/)
  })

  test("refuses a tab that has no rules, and an update on a rule number a tab lacks", async () => {
    const none = await refusedCall("restructure", [{ op: "conditional_delete", index: 0, tab: "My Tab" }])
    expect(none.message).toContain('"My Tab" has no conditional rules')

    const update = await refusedCall("restructure", [
      { op: "conditional_update", index: 7, range: "Plan!B2:B9", when: "BLANK", bold: true },
    ])
    expect(update.message).toContain("there is no rule #7")
  })

  test("takes the tab the rule is on, which a range with no tab stays on, and refuses a range on another tab", async () => {
    const { body } = await sendRestructure(
      [{ op: "conditional_update", tab: "Plan", index: 0, range: "B2:B9", when: "BLANK", bold: true }],
      { spreadsheet: WITH_OBJECTS },
    )
    expect((body.requests[0] as any).updateConditionalFormatRule.rule.ranges).toEqual([PLAN_GRID(1, 9, 1, 2)])

    const error = await refusedCall("restructure", [
      { op: "conditional_update", tab: "Plan", index: 0, range: "'My Tab'!B2:B9", when: "BLANK", bold: true },
    ])
    expect(error.message).toContain('must lie on one tab, "Plan"')
  })
})
