import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { spreadsheetId } from "./spreadsheet-id"

const ID = "1aBcDeFgHiJk_LmNoPqRsTuVwXyZ-0123456789"

function failureOf(value: string): ToolError {
  try {
    spreadsheetId(value)
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected a ToolError")
}

describe("spreadsheetId", () => {
  test("takes a bare id", () => {
    expect(spreadsheetId(ID)).toBe(ID)
    expect(spreadsheetId("a".repeat(10))).toBe("a".repeat(10))
    expect(spreadsheetId("a".repeat(200))).toBe("a".repeat(200))
  })

  test.each([
    `https://docs.google.com/spreadsheets/d/${ID}`,
    `https://docs.google.com/spreadsheets/d/${ID}/`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
    `https://docs.google.com/spreadsheets/d/${ID}?gid=7`,
    `https://docs.google.com/spreadsheets/d/${ID}#gid=7`,
  ])("takes the id out of %s", (url) => {
    expect(spreadsheetId(url)).toBe(ID)
  })

  test.each([
    ["too short", "abc"],
    ["too long", "a".repeat(201)],
    ["with a space", "abcdefghij klm"],
    ["empty", ""],
    ["another host", `https://example.test/spreadsheets/d/${ID}/edit`],
    ["a lookalike host", `https://docs.google.com.example.test/spreadsheets/d/${ID}`],
    ["a plain http URL", `http://docs.google.com/spreadsheets/d/${ID}`],
    ["a document URL", `https://docs.google.com/document/d/${ID}/edit`],
    ["glued to more characters", `https://docs.google.com/spreadsheets/d/${ID}x.y`],
    ["a URL without an id", "https://docs.google.com/spreadsheets/"],
  ])("refuses %s as invalid_argument", (_name, value) => {
    const error = failureOf(value)
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("is neither a spreadsheet id nor a Google Sheets URL.")
  })

  test("never echoes more than 100 characters of the value", () => {
    const error = failureOf("z".repeat(150) + " tail")
    expect(error.message).not.toContain("z".repeat(101))
    expect(error.message).not.toContain("tail")
  })
})
