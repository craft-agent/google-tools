import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import {
  checkedCaptionName,
  checkedCategory,
  checkedDescription,
  checkedLanguage,
  checkedPublishAt,
  checkedTags,
  checkedTitle,
} from "./checks"

const refused = (call: () => unknown) => {
  try {
    call()
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError)
    return (error as ToolError).code
  }
  return "accepted"
}

describe("checkedTitle and checkedDescription", () => {
  test("count a title in characters and a description in UTF-8 bytes", () => {
    expect(refused(() => checkedTitle("😀".repeat(100)))).toBe("accepted")
    expect(refused(() => checkedTitle("😀".repeat(101)))).toBe("invalid_argument")
    expect(refused(() => checkedDescription("😀".repeat(1250)))).toBe("accepted")
    expect(refused(() => checkedDescription("😀".repeat(1251)))).toBe("invalid_argument")
  })

  test("refuse < and > in either, and a blank title", () => {
    for (const call of [() => checkedTitle("<b>"), () => checkedDescription("a>b"), () => checkedTitle(" ")]) {
      expect(refused(call)).toBe("invalid_argument")
    }
  })
})

describe("checkedCaptionName", () => {
  test("takes an empty name and one of 150 characters, and counts characters, not bytes", () => {
    expect(refused(() => checkedCaptionName(""))).toBe("accepted")
    expect(refused(() => checkedCaptionName("😀".repeat(150)))).toBe("accepted")
    expect(refused(() => checkedCaptionName("😀".repeat(151)))).toBe("invalid_argument")
  })

  test("refuses a control character", () => {
    for (const name of ["a\nb", "a\u0000b", "a\tb", "a\u007fb"]) {
      expect(refused(() => checkedCaptionName(name))).toBe("invalid_argument")
    }
  })
})

describe("checkedTags", () => {
  test("count a comma between two tags and 2 more for a tag with a space", () => {
    expect(refused(() => checkedTags(["a".repeat(250), "b".repeat(249)]))).toBe("accepted")
    expect(refused(() => checkedTags(["a".repeat(250), "b".repeat(250)]))).toBe("invalid_argument")
    expect(refused(() => checkedTags([`${"x ".repeat(248)}xy`]))).toBe("accepted")
    expect(refused(() => checkedTags([`${"x ".repeat(248)}xyz`]))).toBe("invalid_argument")
  })

  test("refuse a blank tag and a tag with <, > or a comma", () => {
    for (const tag of ["", "  ", "a<b", "a>b", "a,b"])
      expect(refused(() => checkedTags([tag]))).toBe("invalid_argument")
  })
})

describe("checkedCategory and checkedLanguage", () => {
  test("take up to three digits and a language tag", () => {
    expect(["1", "22", "999"].map((value) => refused(() => checkedCategory(value)))).toEqual(Array(3).fill("accepted"))
    expect(["", "1000", "a1", "-1"].map((value) => refused(() => checkedCategory(value)))).toEqual(
      Array(4).fill("invalid_argument"),
    )
    expect(["en", "ja", "pt-BR", "zh-Hans-CN", "fil"].map((value) => refused(() => checkedLanguage(value)))).toEqual(
      Array(5).fill("accepted"),
    )
    expect(["", "e", "english", "en_US", "en-", "pt-B"].map((value) => refused(() => checkedLanguage(value)))).toEqual(
      Array(6).fill("invalid_argument"),
    )
  })
})

describe("checkedPublishAt", () => {
  test.each([
    ["2026-12-24T00:00:00Z", "2026-12-24T00:00:00Z"],
    ["2026-12-24T09:00:00+09:00", "2026-12-24T00:00:00Z"],
    ["2026-12-23T19:00:00-05:00", "2026-12-24T00:00:00Z"],
    ["2026-12-24t00:00:00z", "2026-12-24T00:00:00Z"],
    ["2026-12-24T00:00:00.25Z", "2026-12-24T00:00:00.250Z"],
    ["2026-12-24T00:00:00.123456789Z", "2026-12-24T00:00:00.123Z"],
    ["2028-02-29T10:30:00+05:30", "2028-02-29T05:00:00Z"],
  ])("normalizes %s to UTC", (given, utc) => {
    expect(checkedPublishAt(given)).toBe(utc)
  })

  test.each([
    "",
    "2026-12-24",
    "2026-12-24T00:00:00",
    "2026-12-24 00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2027-02-29T00:00:00Z",
    "2026-12-24T24:00:00Z",
    "2026-12-24T00:60:00Z",
    "2026-12-24T00:00:60Z",
    "2026-12-24T00:00:00+24:00",
    "2026-12-24T00:00:00+09:60",
  ])("refuses %p", (given) => {
    expect(refused(() => checkedPublishAt(given))).toBe("invalid_argument")
  })
})
