import { describe, expect, test } from "bun:test"
import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  GMAIL_TOOLSET,
} from "../gmail/scopes"
import { SHEETS_TOOLSET } from "../sheets/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes, needsWrite, toolsetsFor } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]

describe("the gmail toolset's scopes", () => {
  test("a login for gmail asks for the identity, the read scope and the three that write, sorted", () => {
    expect(loginScopes([GMAIL_TOOLSET], false)).toEqual(
      [...IDENTITY, GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE].sort(),
    )
  })

  test("--read-only holds only the identity and gmail.readonly", () => {
    expect(loginScopes([GMAIL_TOOLSET], true)).toEqual([...IDENTITY, GMAIL_READ_SCOPE].sort())
  })

  test("a sheets label holds no mail scope", () => {
    const scopes = loginScopes([SHEETS_TOOLSET], false)
    expect(scopes.filter((scope) => scope.includes("/auth/gmail."))).toEqual([])
  })

  test("the toolset is covered by its read scope and read only without the write scopes", () => {
    const held = [...IDENTITY, GMAIL_READ_SCOPE]
    expect(grantedToolsets(held)).toEqual({ toolsets: ["account", GMAIL_TOOLSET], readOnly: [GMAIL_TOOLSET] })
    expect(grantedToolsets([...held, GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE]).readOnly).toEqual([GMAIL_TOOLSET])
    expect(grantedToolsets([...held, GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE]).readOnly).toEqual([])
  })

  test("a call that the read scope or the modify scope allows needs no write", () => {
    expect(needsWrite([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE])).toBe(false)
    expect(needsWrite([GMAIL_SEND_SCOPE])).toBe(true)
    expect(toolsetsFor([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE])).toEqual([GMAIL_TOOLSET])
  })
})
