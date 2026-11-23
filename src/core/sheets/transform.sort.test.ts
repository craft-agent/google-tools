import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID, WITH_OBJECTS } from "./structure.testing"
import { describeTransform, refusedTransform, sendTransform } from "./transform.testing"
import { SPREADSHEET } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** `WITH_OBJECTS`, whose tab `Plan` has a basic filter over `A1:F50`. */
const FILTERED = { spreadsheet: WITH_OBJECTS }

/** `SPREADSHEET` with a basic filter on `Plan` that names no range, which covers the whole tab. */
const FILTERED_WHOLE_TAB = {
  spreadsheet: {
    ...SPREADSHEET,
    sheets: SPREADSHEET.sheets.map((sheet) =>
      sheet.properties.title === "Plan" ? { ...sheet, basicFilter: { filterSpecs: [] } } : sheet,
    ),
  },
}

const sortOf = (range: string) => ({ op: "sort", range, by: [{ column: "A" }] })

const REFUSAL = (tab: string, over: string) =>
  `${JSON.stringify(tab)} has a basic filter over ${over}, and sorting under it moves only the rows the filter shows; clear the filter first with google_sheets_restructure's filter_clear.`

describe("google_sheets_transform: sort under a basic filter", () => {
  test.each([
    ["a range inside the filter's", "Plan!A1:D20"],
    ["a range that reaches into the filter's", "Plan!E40:H60"],
    ["a range that covers the filter's", "Plan!A1:Z200"],
  ])("refuses %s, naming the filter, and writes nothing", async (_name, range) => {
    const error = await refusedTransform([sortOf(range)], FILTERED)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(REFUSAL("Plan", "Plan!A1:F50"))
  })

  test("refuses a filter that names no range, which covers the whole tab", async () => {
    const error = await refusedTransform([sortOf("Plan!H60:J80")], FILTERED_WHOLE_TAB)

    expect(error.message).toBe(REFUSAL("Plan", "Plan"))
  })

  test("refuses in the description of the call too, before the approval", async () => {
    const error = await toolError(describeTransform([sortOf("Plan!A1:D20")], FILTERED))

    expect(error.message).toBe(REFUSAL("Plan", "Plan!A1:F50"))
  })

  test.each([
    ["to the right of the filter", "Plan!H1:J20", "H", PLAN_GRID(1, 20, 7, 10), 7],
    ["below the filter", "Plan!A60:D80", "A", PLAN_GRID(60, 80, 0, 4), 0],
    ["on another tab than the filter's", "'My Tab'!A1:D20", "A", { ...PLAN_GRID(1, 20, 0, 4), sheetId: 77 }, 0],
  ])("sorts a range %s", async (_name, range, column, grid, dimensionIndex) => {
    const { requests } = await sendTransform([{ op: "sort", range, by: [{ column }] }], FILTERED)

    expect(requests).toEqual([{ sortRange: { range: grid, sortSpecs: [{ dimensionIndex, sortOrder: "ASCENDING" }] } }])
  })

  test("sorts a tab that has no filter, as before", async () => {
    const { requests } = await sendTransform([sortOf("Plan!A1:D20")])

    expect(requests).toHaveLength(1)
  })
})
