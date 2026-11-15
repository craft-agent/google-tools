import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PROTECTIONS, refusedProtect, sendProtect } from "./protect.testing"
import { cleanUp, freshTokens } from "./read.testing"
import { PLAN_GRID } from "./structure.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const MY_TAB = { sheetId: 77 }

describe("google_sheets_protect: protect", () => {
  test("adds a protection of a block with its label and editors, trimmed, lower-cased and deduplicated", async () => {
    const { body } = await sendProtect([
      {
        op: "protect",
        range: "Plan!A1:C5",
        label: " Budget ",
        editors: [" Ann@Example.test ", "bob@example.test", "ANN@example.test"],
      },
    ])

    expect(body.includeSpreadsheetInResponse).toBe(false)
    expect(body.requests).toEqual([
      {
        addProtectedRange: {
          protectedRange: {
            range: PLAN_GRID(0, 5, 0, 3),
            description: "Budget",
            warningOnly: false,
            editors: { users: ["ann@example.test", "bob@example.test"] },
          },
        },
      },
    ])
  })

  test("protects a whole tab by its title alone, with the ranges left editable on that tab", async () => {
    const { body } = await sendProtect([
      { op: "protect", range: "my tab", except: ["B2:B20", "'My Tab'!D:D"], editors: [] },
    ])

    expect(body.requests).toEqual([
      {
        addProtectedRange: {
          protectedRange: {
            range: MY_TAB,
            unprotectedRanges: [
              { sheetId: 77, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 1, endColumnIndex: 2 },
              { sheetId: 77, startColumnIndex: 3, endColumnIndex: 4 },
            ],
            warningOnly: false,
            editors: { users: [] },
          },
        },
      },
    ])
  })

  test("sends no editors and no label when none are given, and a warning-only protection sends no editors", async () => {
    const { body } = await sendProtect([
      { op: "protect", range: "Plan!B:B" },
      { op: "protect", range: "My Tab", warning_only: true, label: "" },
    ])

    expect(body.requests).toEqual([
      {
        addProtectedRange: {
          protectedRange: { range: { sheetId: 0, startColumnIndex: 1, endColumnIndex: 2 }, warningOnly: false },
        },
      },
      { addProtectedRange: { protectedRange: { range: MY_TAB, warningOnly: true } } },
    ])
  })

  test.each([
    ["a block", { range: "Plan!A1:B2", except: ["A1"] }, "goes with a protection of a whole tab"],
    ["a range of another tab", { range: "Plan", except: ["'My Tab'!A1:A2"] }, "cell ranges on the protected tab"],
    ["a whole tab", { range: "Plan", except: ["Plan"] }, "cell ranges on the protected tab"],
  ])("refuses `except` for %s", async (_name, fields, message) => {
    const error = await refusedProtect([{ op: "protect", ...fields }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("refuses a range of a tab the spreadsheet lacks", async () => {
    const error = await refusedProtect([{ op: "protect", range: "Nope!A1:B2" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("names no tab of the spreadsheet")
  })
})

describe("google_sheets_protect: protect_update", () => {
  test("changes the range and the label, the range without a tab staying on the protection's tab", async () => {
    const { body } = await sendProtect([{ op: "protect_update", protection: 7, range: "B2:C3", label: "Top" }])

    expect(body.requests).toEqual([
      {
        updateProtectedRange: {
          protectedRange: { protectedRangeId: 7, range: PLAN_GRID(1, 3, 1, 3), description: "Top" },
          fields: "range,description",
        },
      },
    ])
  })

  test("moves a protection to a whole tab, and clears a label with an empty text", async () => {
    const { body } = await sendProtect([{ op: "protect_update", protection: "Header", range: "a/b", label: "" }])

    expect(body.requests[0]!.updateProtectedRange).toEqual({
      protectedRange: { protectedRangeId: 7, range: { sheetId: 5 }, description: "" },
      fields: "range,description",
    })
  })

  test("replaces the editors, which makes the protection block and drops its groups and the domain's access", async () => {
    const { body } = await sendProtect([{ op: "protect_update", protection: "Locked", editors: ["Ann@example.test"] }])

    expect(body.requests).toEqual([
      {
        updateProtectedRange: {
          protectedRange: { protectedRangeId: 9, warningOnly: false, editors: { users: ["ann@example.test"] } },
          fields: "warningOnly,editors",
        },
      },
    ])
  })

  test("turns the warning on, which sends nothing else", async () => {
    const { body } = await sendProtect([{ op: "protect_update", protection: 7, warning_only: true }])

    expect(body.requests).toEqual([
      { updateProtectedRange: { protectedRange: { protectedRangeId: 7, warningOnly: true }, fields: "warningOnly" } },
    ])
  })

  test("turns the warning off with the editors, and replaces the ranges left editable", async () => {
    const { body } = await sendProtect([
      { op: "protect_update", protection: 8, warning_only: false, editors: [] },
      { op: "protect_update", protection: "Whole", except: [] },
      { op: "protect_update", protection: "Whole", except: ["C3:C9"] },
    ])

    expect(body.requests.map((request) => request.updateProtectedRange)).toEqual([
      {
        protectedRange: { protectedRangeId: 8, warningOnly: false, editors: { users: [] } },
        fields: "warningOnly,editors",
      },
      { protectedRange: { protectedRangeId: 13, unprotectedRanges: [] }, fields: "unprotectedRanges" },
      {
        protectedRange: {
          protectedRangeId: 13,
          unprotectedRanges: [{ sheetId: 5, startRowIndex: 2, endRowIndex: 9, startColumnIndex: 2, endColumnIndex: 3 }],
        },
        fields: "unprotectedRanges",
      },
    ])
  })

  test("refuses `except` for a protection of a block, now or once the range is one", async () => {
    const block = await refusedProtect([{ op: "protect_update", protection: 7, except: ["A2:A9"] }])
    const moved = await refusedProtect([{ op: "protect_update", protection: "Whole", range: "A1:B2", except: [] }])

    expect(block.message).toContain("goes with a protection of a whole tab")
    expect(moved.message).toContain("goes with a protection of a whole tab")
  })

  test("sees what an earlier operation of the call did to the protection", async () => {
    const { body } = await sendProtect([
      { op: "protect_update", protection: "Header", label: "Top" },
      { op: "protect_update", protection: "Top", warning_only: true },
    ])

    expect(body.requests.map((request) => request.updateProtectedRange.protectedRange.protectedRangeId)).toEqual([7, 7])
  })
})

describe("google_sheets_protect: protect_delete", () => {
  test("removes the protection by its id, its label or its label in other letters", async () => {
    const { body } = await sendProtect([
      { op: "protect_delete", protection: 7 },
      { op: "protect_delete", protection: "LOCKED" },
      { op: "protect_delete", protection: "13" },
    ])

    expect(body.requests).toEqual([
      { deleteProtectedRange: { protectedRangeId: 7 } },
      { deleteProtectedRange: { protectedRangeId: 9 } },
      { deleteProtectedRange: { protectedRangeId: 13 } },
    ])
  })

  test("refuses an operation on a protection an earlier one removed", async () => {
    const error = await refusedProtect([
      { op: "protect_delete", protection: 7 },
      { op: "protect_update", protection: 7, label: "Again" },
    ])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("No protection matches")
  })
})

describe("google_sheets_protect: finding a protection", () => {
  test("refuses an unknown protection, listing the protections by id and label", async () => {
    const error = await refusedProtect([{ op: "protect_delete", protection: "Nope" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('No protection matches "Nope"')
    expect(error.message).toContain(
      '#7 "Header", #9 "Locked", #12 "Theirs", #8, #10 "Shared", #11 "Shared", #13 "Whole".',
    )
  })

  test("refuses a label two protections share, naming both by id", async () => {
    const error = await refusedProtect([{ op: "protect_update", protection: "shared", label: "One" }])

    expect(error.message).toContain('Several protections match "shared"')
    expect(error.message).toContain('#10 "Shared", #11 "Shared"')
  })

  test("takes a shared label by the id of one of its protections", async () => {
    const { body } = await sendProtect([{ op: "protect_delete", protection: 11 }])

    expect(body.requests).toEqual([{ deleteProtectedRange: { protectedRangeId: 11 } }])
  })

  test("lists at most 20 protections", async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      protectedRangeId: 100 + index,
      range: PLAN_GRID(index, index + 1, 0, 1),
      requestingUserCanEdit: true,
    }))

    const error = await refusedProtect([{ op: "protect_delete", protection: "x" }], { protections: many })

    expect(error.message).toContain("#119 (+5 more)")
  })

  test.each([
    ["protect_update", { label: "X" }],
    ["protect_delete", {}],
  ])("refuses %s of a protection the account cannot edit", async (op, fields) => {
    const error = await refusedProtect([{ op, protection: "Theirs", ...fields }])

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain('#12 "Theirs"')
  })

  test("takes only what the spreadsheet's tabs still have", async () => {
    const stray = { protectedRangeId: 99, range: { sheetId: 4242 }, description: "Gone", requestingUserCanEdit: true }

    const error = await refusedProtect([{ op: "protect_delete", protection: 99 }], {
      protections: [...PROTECTIONS, stray],
    })

    expect(error.message).toContain("No protection matches")
  })
})
