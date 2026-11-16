import { describe, expect, test } from "bun:test"
import { mentionedAddresses } from "./mentions"

describe("mentionedAddresses", () => {
  test("finds a `+` or `@` mention at the start and after whitespace, in order", () => {
    expect(mentionedAddresses("+ann@example.test please look; @bob@example.test too\n+cy@example.test")).toEqual([
      "ann@example.test",
      "bob@example.test",
      "cy@example.test",
    ])
  })

  test("lower-cases an address and lists it once, at its first place", () => {
    expect(mentionedAddresses("+Ann@Example.test then +bob@example.test and +ann@example.TEST")).toEqual([
      "ann@example.test",
      "bob@example.test",
    ])
  })

  test.each([
    ["a full stop", "thanks +ann@example.test.", "ann@example.test"],
    ["a comma", "+ann@example.test, please", "ann@example.test"],
    ["a closing bracket", "(cc +ann@example.test)", "ann@example.test"],
    ["every kind in a row", "+ann@example.test.,;:!?)", "ann@example.test"],
    ["a question", "ok +ann@example.test?", "ann@example.test"],
  ])("strips trailing punctuation: %s", (_name, text, address) => {
    expect(mentionedAddresses(text)).toEqual([address])
  })

  test.each([
    ["an address with no mark", "mail ann@example.test"],
    ["a mark glued to a word", "word+ann@example.test"],
    ["a mark after a bracket", "(+ann@example.test)"],
    ["a mark with no address", "+ann and @bob"],
    ["a host with no dot", "+ann@localhost"],
    ["an address with nothing left after its punctuation", "+ann@example.."],
    ["no text at all", ""],
  ])("does not mention %s", (_name, text) => {
    expect(mentionedAddresses(text)).toEqual([])
  })
})
