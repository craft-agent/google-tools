import { describe, expect, test } from "bun:test"
import { accessEntry, isShared } from "./sharing"

const OWNER = "Owner@Example.test"
const owned = { type: "user", emailAddress: "owner@example.test" } as const

describe("isShared", () => {
  test("a file with only its owner's permission is not shared", () => {
    expect(isShared([owned], [OWNER], null)).toBe(false)
    expect(isShared([owned], [OWNER], undefined)).toBe(false)
  })

  test("a list with no permission is not shared either", () => {
    expect(isShared([], [OWNER], null)).toBe(false)
  })

  test("the owner's address is compared ignoring case", () => {
    expect(isShared([{ type: "user", emailAddress: "OWNER@EXAMPLE.TEST" }], [OWNER], null)).toBe(false)
  })

  test.each([
    ["another person", { type: "user", emailAddress: "ann@example.test" }],
    ["a group", { type: "group", emailAddress: "team@example.test" }],
    ["a domain", { type: "domain" }],
    ["anyone", { type: "anyone" }],
    ["a group at the owner's address", { type: "group", emailAddress: "owner@example.test" }],
    ["a person with no address", { type: "user" }],
  ] as const)("a permission for %s makes it shared", (_name, permission) => {
    expect(isShared([owned, permission], [OWNER], null)).toBe(true)
  })

  test("a file in a shared drive is shared whatever its permissions", () => {
    expect(isShared([owned], [OWNER], "0ADriveId")).toBe(true)
    expect(isShared([], [OWNER], "0ADriveId")).toBe(true)
  })

  test("with no owner known, nothing proves the file is the account's alone", () => {
    expect(isShared([owned], [], null)).toBe(true)
  })

  test("every owner's own permission is the owner's", () => {
    const both = [owned, { type: "user", emailAddress: "second@example.test" }] as const
    expect(isShared(both, [OWNER, "second@example.test"], null)).toBe(false)
  })
})

describe("accessEntry", () => {
  const base = { type: "user", role: "reader" } as const

  test("keeps only what Google gave", () => {
    expect(accessEntry(base)).toEqual({ type: "user", role: "reader" })
  })

  test("`discoverable` is only for anyone and domain", () => {
    expect(accessEntry({ ...base, allowFileDiscovery: true })).not.toHaveProperty("discoverable")
    expect(accessEntry({ type: "anyone", role: "reader", allowFileDiscovery: false })).toMatchObject({
      discoverable: false,
    })
    expect(accessEntry({ type: "domain", role: "reader", allowFileDiscovery: true })).toMatchObject({
      discoverable: true,
    })
  })

  test("is inherited only when every grant comes from a folder above", () => {
    const from = (...flags: boolean[]) =>
      accessEntry({
        ...base,
        permissionDetails: flags.map((inherited) => ({ inherited, ...(inherited && { inheritedFrom: "f1" }) })),
      })

    expect(from(true)).toMatchObject({ inherited: true, inherited_from: "f1" })
    expect(from(true, false)).toEqual({ type: "user", role: "reader", inherited: false })
    expect(from(false)).toEqual({ type: "user", role: "reader", inherited: false })
    expect(accessEntry({ ...base, permissionDetails: [] })).not.toHaveProperty("inherited")
  })
})
