import { describe, expect, test } from "bun:test"
import { YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE, YOUTUBE_TOOLSET } from "../youtube/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes, needsWrite, toolsetsFor } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]
const READ_SCOPES = [YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_READ_SCOPE]

describe("the youtube toolset's scopes", () => {
  test("a login for youtube asks for the identity, both read scopes and force-ssl, sorted", () => {
    expect(loginScopes([YOUTUBE_TOOLSET], false)).toEqual([...IDENTITY, ...READ_SCOPES, YOUTUBE_SCOPE].sort())
  })

  test("--read-only leaves out the scope that writes", () => {
    const scopes = loginScopes([YOUTUBE_TOOLSET], true)
    expect(scopes).toEqual([...IDENTITY, ...READ_SCOPES].sort())
    expect(scopes).not.toContain(YOUTUBE_SCOPE)
  })

  test("the toolset is covered by both read scopes and read only without force-ssl", () => {
    const held = [...IDENTITY, ...READ_SCOPES]
    expect(grantedToolsets(held)).toEqual({ toolsets: ["account", YOUTUBE_TOOLSET], readOnly: [YOUTUBE_TOOLSET] })
    expect(grantedToolsets([...held, YOUTUBE_SCOPE]).readOnly).toEqual([])
    expect(grantedToolsets([YOUTUBE_READ_SCOPE]).toolsets).toEqual([])
  })

  test("force-ssl names the youtube toolset", () => {
    expect(toolsetsFor([YOUTUBE_SCOPE])).toEqual([YOUTUBE_TOOLSET])
  })

  test("a call that only force-ssl allows needs a write scope", () => {
    expect(needsWrite([YOUTUBE_SCOPE])).toBe(true)
    expect(needsWrite([YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE])).toBe(false)
  })
})
