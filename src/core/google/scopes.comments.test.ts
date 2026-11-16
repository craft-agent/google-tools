import { describe, expect, test } from "bun:test"
import { COMMENTS_TOOLSET } from "../comments/scopes"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE, DRIVE_TOOLSET } from "../drive/scopes"
import { SHEETS_READ_SCOPE, SHEETS_TOOLSET, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes, needsWrite, toolsetsFor } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]

const READ = [SHEETS_READ_SCOPE, DRIVE_READ_SCOPE]

describe("the comments toolset's scopes", () => {
  test("a login for comments asks for the identity, both read scopes and both write scopes, sorted", () => {
    expect(loginScopes([COMMENTS_TOOLSET], false)).toEqual(
      [...IDENTITY, ...READ, SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE].sort(),
    )
  })

  test("--read-only holds only the identity and the read scopes", () => {
    expect(loginScopes([COMMENTS_TOOLSET], true)).toEqual([...IDENTITY, ...READ].sort())
  })

  test("the toolset is covered only by both read scopes, and read only without both write scopes", () => {
    const read = [...IDENTITY, ...READ]
    expect(grantedToolsets(read)).toEqual({
      toolsets: ["account", DRIVE_TOOLSET, COMMENTS_TOOLSET],
      readOnly: [DRIVE_TOOLSET, COMMENTS_TOOLSET],
    })
    expect(grantedToolsets([...IDENTITY, DRIVE_READ_SCOPE]).toolsets).toEqual(["account", DRIVE_TOOLSET])
    expect(grantedToolsets([...IDENTITY, SHEETS_READ_SCOPE]).toolsets).toEqual(["account"])
    expect(grantedToolsets([...read, SHEETS_WRITE_SCOPE]).readOnly).toEqual([DRIVE_TOOLSET, COMMENTS_TOOLSET])
    expect(grantedToolsets([...read, SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE]).readOnly).toEqual([])
  })

  test("a sheets login holds the sheets scopes without making the comments toolset covered", () => {
    expect(grantedToolsets(loginScopes([SHEETS_TOOLSET], false)).toolsets).toEqual(["account", SHEETS_TOOLSET])
  })

  test("a call that either read scope allows needs no write", () => {
    expect(needsWrite([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE])).toBe(false)
    expect(needsWrite([DRIVE_FILE_SCOPE])).toBe(true)
  })

  test("the calling tool's own toolset is the one a missing scope names, whoever else holds it", () => {
    expect(toolsetsFor([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE], COMMENTS_TOOLSET)).toEqual([COMMENTS_TOOLSET])
    expect(toolsetsFor([DRIVE_READ_SCOPE], DRIVE_TOOLSET)).toEqual([DRIVE_TOOLSET])
    expect(toolsetsFor([DRIVE_READ_SCOPE], COMMENTS_TOOLSET)).toEqual([COMMENTS_TOOLSET])
  })

  test("without an own toolset, a shared scope names every toolset that holds it", () => {
    expect(toolsetsFor([SHEETS_READ_SCOPE])).toEqual([SHEETS_TOOLSET, COMMENTS_TOOLSET])
    expect(toolsetsFor([DRIVE_FILE_SCOPE])).toEqual([DRIVE_TOOLSET, COMMENTS_TOOLSET])
  })
})
