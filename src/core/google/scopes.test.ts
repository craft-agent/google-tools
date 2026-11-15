import { afterEach, describe, expect, test } from "bun:test"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { IDENTITY_SCOPES, TOOLSET_SCOPES, loginScopes, type ToolsetScopes } from "./scopes"

const SHEETS_READ = "https://www.example.test/auth/sheets.readonly"
const SHEETS_WRITE = "https://www.example.test/auth/sheets"
const DRIVE_READ = "https://www.example.test/auth/drive.readonly"

/** The toolsets the package has so far hold no scopes, so a test adds its own and removes them afterwards. */
const added: string[] = []

function addToolset(name: string, scopes: ToolsetScopes): void {
  ;(TOOLSET_SCOPES as Record<string, ToolsetScopes>)[name] = scopes
  added.push(name)
}

afterEach(() => {
  for (const name of added.splice(0)) delete (TOOLSET_SCOPES as Record<string, ToolsetScopes>)[name]
})

function failureOf(run: () => unknown): { code?: string; message: string } {
  try {
    run()
  } catch (error) {
    return error as { code?: string; message: string }
  }
  throw new Error("expected the call to throw")
}

describe("IDENTITY_SCOPES", () => {
  test("are openid and the address", () => {
    expect(IDENTITY_SCOPES).toEqual([OPENID_SCOPE, EMAIL_SCOPE])
  })
})

describe("loginScopes", () => {
  test("a label logged in for account only holds openid and the address", () => {
    expect(loginScopes(["account"], false)).toEqual([EMAIL_SCOPE, OPENID_SCOPE].sort())
    expect(loginScopes(["account"], true)).toEqual([EMAIL_SCOPE, OPENID_SCOPE].sort())
  })

  test("adds the read and write scopes of each toolset, deduplicated and sorted", () => {
    addToolset("sheets", { read: [SHEETS_READ], write: [SHEETS_WRITE, SHEETS_READ] })
    addToolset("drive", { read: [DRIVE_READ], write: [] })

    const scopes = loginScopes(["sheets", "drive", "sheets"], false)

    expect(scopes).toEqual([...new Set([OPENID_SCOPE, EMAIL_SCOPE, SHEETS_READ, SHEETS_WRITE, DRIVE_READ])].sort())
  })

  test("only the read scopes with readOnly", () => {
    addToolset("sheets", { read: [SHEETS_READ], write: [SHEETS_WRITE] })

    expect(loginScopes(["sheets"], true)).toEqual([OPENID_SCOPE, EMAIL_SCOPE, SHEETS_READ].sort())
  })

  test("no toolset asks for the identity scopes alone", () => {
    expect(loginScopes([], false)).toEqual([OPENID_SCOPE, EMAIL_SCOPE].sort())
  })

  test("an unknown toolset is invalid_argument listing the known ones, without repeating it", () => {
    const error = failureOf(() => loginScopes(["nope_toolset"], false))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("account")
    expect(error.message).not.toContain("nope_toolset")
  })

  test("a name of Object.prototype is unknown too", () => {
    expect(failureOf(() => loginScopes(["constructor"], false)).code).toBe("invalid_argument")
  })
})
