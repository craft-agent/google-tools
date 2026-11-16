import { describe, expect, test } from "bun:test"
import { COMMENTS_TOOLSET } from "../comments/scopes"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE, DRIVE_TOOLSET } from "../drive/scopes"
import { GMAIL_TOOLSET } from "../gmail/scopes"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_TOOLSET } from "../sheets/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes, needsWrite, toolsetsFor } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]

describe("the drive toolset's scopes", () => {
  test("a login for drive asks for the identity, drive.readonly and drive.file, sorted", () => {
    expect(loginScopes([DRIVE_TOOLSET], false)).toEqual([...IDENTITY, DRIVE_READ_SCOPE, DRIVE_FILE_SCOPE].sort())
  })

  test("--read-only holds only the identity and drive.readonly", () => {
    expect(loginScopes([DRIVE_TOOLSET], true)).toEqual([...IDENTITY, DRIVE_READ_SCOPE].sort())
  })

  test("a gmail label holds no Drive scope", () => {
    const scopes = loginScopes([GMAIL_TOOLSET], false)
    expect(scopes.filter((scope) => scope.includes("/auth/drive"))).toEqual([])
  })

  test("a sheets label holds the metadata scope, never the content one", () => {
    const scopes = loginScopes([SHEETS_TOOLSET], false)
    expect(scopes).toContain(DRIVE_METADATA_READ_SCOPE)
    expect(scopes).not.toContain(DRIVE_READ_SCOPE)
  })

  test("the toolset is covered by drive.readonly and read only without drive.file", () => {
    const held = [...IDENTITY, DRIVE_READ_SCOPE]
    expect(grantedToolsets(held)).toEqual({ toolsets: ["account", DRIVE_TOOLSET], readOnly: [DRIVE_TOOLSET] })
    expect(grantedToolsets([...held, DRIVE_FILE_SCOPE]).readOnly).toEqual([])
  })

  test("a call that drive.readonly allows needs no write", () => {
    expect(needsWrite([DRIVE_READ_SCOPE])).toBe(false)
    expect(needsWrite([DRIVE_FILE_SCOPE])).toBe(true)
    expect(toolsetsFor([DRIVE_READ_SCOPE])).toEqual([DRIVE_TOOLSET, COMMENTS_TOOLSET])
    expect(toolsetsFor([DRIVE_READ_SCOPE], DRIVE_TOOLSET)).toEqual([DRIVE_TOOLSET])
  })
})
