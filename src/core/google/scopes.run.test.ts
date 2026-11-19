import { describe, expect, test } from "bun:test"
import { RUN_READ_SCOPE, RUN_SCOPE, RUN_TOOLSET } from "../run/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { grantedToolsets, loginScopes, toolsetsFor } from "./scopes"

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]
const WORKSPACE_SCOPE = /^https:\/\/www\.googleapis\.com\/auth\/(?:drive|spreadsheets|gmail)/
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

describe("the run toolset's scopes", () => {
  test("a login for run asks for the identity, run.readonly and run, sorted", () => {
    expect(loginScopes([RUN_TOOLSET], false)).toEqual([...IDENTITY, RUN_READ_SCOPE, RUN_SCOPE].sort())
  })

  test("--read-only leaves out the scope that writes", () => {
    const scopes = loginScopes([RUN_TOOLSET], true)
    expect(scopes).toEqual([...IDENTITY, RUN_READ_SCOPE].sort())
    expect(scopes).not.toContain(RUN_SCOPE)
  })

  test("the toolset is covered by run.readonly and read only without run", () => {
    const held = [...IDENTITY, RUN_READ_SCOPE]
    expect(grantedToolsets(held)).toEqual({ toolsets: ["account", RUN_TOOLSET], readOnly: [RUN_TOOLSET] })
    expect(grantedToolsets([...held, RUN_SCOPE]).readOnly).toEqual([])
    expect(grantedToolsets([RUN_SCOPE]).toolsets).toEqual([])
  })

  test("run.readonly belongs to the run toolset alone", () => {
    expect(toolsetsFor([RUN_READ_SCOPE])).toEqual([RUN_TOOLSET])
  })

  test("a run label holds no Workspace scope and never cloud-platform", () => {
    const scopes = loginScopes([RUN_TOOLSET], false)
    expect(scopes.filter((scope) => WORKSPACE_SCOPE.test(scope))).toEqual([])
    expect(scopes).not.toContain(CLOUD_PLATFORM_SCOPE)
  })
})
