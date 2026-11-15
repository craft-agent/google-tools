import { describe, expect, test } from "bun:test"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_TOOLSET, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]
const GMAIL_SCOPE = /^https:\/\/www\.googleapis\.com\/auth\/gmail\./
const CLOUD_SCOPES = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/run"]

describe("the sheets toolset's scopes", () => {
  test("a login for sheets asks for the identity, the two read scopes and the write scope, sorted", () => {
    expect(loginScopes([SHEETS_TOOLSET], false)).toEqual(
      [...IDENTITY, SHEETS_READ_SCOPE, DRIVE_METADATA_READ_SCOPE, SHEETS_WRITE_SCOPE].sort(),
    )
  })

  test("--read-only leaves out the scope that writes", () => {
    const scopes = loginScopes([SHEETS_TOOLSET], true)
    expect(scopes).toEqual([...IDENTITY, SHEETS_READ_SCOPE, DRIVE_METADATA_READ_SCOPE].sort())
    expect(scopes).not.toContain(SHEETS_WRITE_SCOPE)
  })

  test("a sheets label holds no mail and no Cloud scope", () => {
    const scopes = loginScopes([SHEETS_TOOLSET], false)
    expect(scopes.filter((scope) => GMAIL_SCOPE.test(scope))).toEqual([])
    expect(scopes.filter((scope) => CLOUD_SCOPES.includes(scope))).toEqual([])
  })

  test("the toolset is covered by its read scopes and read only without the write scope", () => {
    const held = [...IDENTITY, SHEETS_READ_SCOPE, DRIVE_METADATA_READ_SCOPE]
    expect(grantedToolsets(held)).toEqual({ toolsets: ["account", SHEETS_TOOLSET], readOnly: [SHEETS_TOOLSET] })
    expect(grantedToolsets([...held, SHEETS_WRITE_SCOPE]).readOnly).toEqual([])
    expect(grantedToolsets([SHEETS_READ_SCOPE]).toolsets).toEqual([])
  })
})
