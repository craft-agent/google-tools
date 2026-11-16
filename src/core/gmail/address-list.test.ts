import { describe, expect, test } from "bun:test"
import { addressOf, splitAddressList } from "./address-list"

describe("splitAddressList", () => {
  test("splits at commas, with white space and folds as one space", () => {
    expect(splitAddressList("ann@example.test,  bob@example.test,\r\n cy@example.test")).toEqual([
      "ann@example.test",
      "bob@example.test",
      "cy@example.test",
    ])
  })

  test("keeps a comma inside a quoted name or angle brackets", () => {
    expect(splitAddressList('"Lee, Ann" <ann@example.test>, "Bo \\", B" <bo@example.test>')).toEqual([
      '"Lee, Ann" <ann@example.test>',
      '"Bo \\", B" <bo@example.test>',
    ])
  })

  test("drops comments, nested ones too, and empty items", () => {
    expect(splitAddressList("ann@example.test (Ann, the (first) one), , <bo@example.test>,")).toEqual([
      "ann@example.test",
      "<bo@example.test>",
    ])
  })

  test("an empty or blank header has no item", () => {
    expect(splitAddressList("")).toEqual([])
    expect(splitAddressList(" \r\n ")).toEqual([])
  })
})

describe("addressOf", () => {
  test.each([
    ["ann@example.test", "ann@example.test"],
    ["<ann@example.test>", "ann@example.test"],
    ["Ann Lee <ann@example.test>", "ann@example.test"],
    ['"Lee, Ann" <Ann@Example.test>', "Ann@Example.test"],
    ["=?UTF-8?B?44Ki44Oz?= <ann@example.test>", "ann@example.test"],
    ["Ann < ann@example.test >", "ann@example.test"],
  ])("%s is %s", (item, address) => {
    expect(addressOf(item)).toBe(address)
  })

  test.each([
    "undisclosed-recipients:;",
    "Group: ann@example.test;",
    "Ann",
    "ann@example",
    "Ann <ann>",
    "Ann <ann@example.test> trailing",
    '"a b"@example.test',
    "<a@example.test><b@example.test>",
  ])("%s holds no address", (item) => {
    expect(addressOf(item)).toBeUndefined()
  })
})
