import { describe, expect, test } from "bun:test"
import { keywordsOf, keywordsText, mergedKeywords } from "./channel-keywords"

describe("keywordsOf", () => {
  test("reads words and quoted phrases, each phrase as one", () => {
    expect(keywordsOf('made "made up" things')).toEqual(["made", "made up", "things"])
  })

  test("reads none from no text, an empty one or one of blanks and empty quotes", () => {
    expect(keywordsOf(undefined)).toEqual([])
    expect(keywordsOf("")).toEqual([])
    expect(keywordsOf('  ""  " "  ')).toEqual([])
  })
})

describe("keywordsText", () => {
  test("writes a space between keywords and double quotes around one with whitespace", () => {
    expect(keywordsText(["made", "made up", "things"])).toBe('made "made up" things')
    expect(keywordsText(["日本語 の", "x"])).toBe('"日本語 の" x')
    expect(keywordsText([])).toBe("")
  })

  test.each([
    [[]],
    [["a"]],
    [["a", "b c", "d"]],
    [["two  spaces", "one"]],
    [["日本語", "made up", "tab\there"]],
    [["a-b", "c.d", "e,f"]],
  ])("is read back by keywordsOf: %p", (keywords) => {
    expect(keywordsOf(keywordsText(keywords))).toEqual(keywords)
  })
})

describe("mergedKeywords", () => {
  test("removes the keywords named, then adds the new ones at the end, each once and in order", () => {
    expect(mergedKeywords(["a", "b", "c"], ["d", "a"], ["b"])).toEqual(["a", "c", "d"])
    expect(mergedKeywords(["a", "b"], ["c", "c"], [])).toEqual(["a", "b", "c"])
  })

  test("matches exactly, so a keyword that is not there is ignored", () => {
    expect(mergedKeywords(["Made Up"], [], ["made up", "Made"])).toEqual(["Made Up"])
  })

  test("leaves none when every keyword is removed", () => {
    expect(mergedKeywords(["a", "b"], [], ["a", "b"])).toEqual([])
  })
})
