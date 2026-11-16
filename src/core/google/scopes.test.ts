import { afterEach, describe, expect, test } from "bun:test"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { IDENTITY_SCOPES, TOOLSET_SCOPES, loginScopes, needsWrite, toolsetsFor, type ToolsetScopes } from "./scopes"

const NOTES_READ = "https://www.example.test/auth/notes.readonly"
const NOTES_WRITE = "https://www.example.test/auth/notes"
const FILES_READ = "https://www.example.test/auth/files.readonly"

/** A test adds stand-in toolsets of its own, named apart from the package's, and removes them afterwards. */
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
    addToolset("notes", { read: [NOTES_READ], write: [NOTES_WRITE, NOTES_READ] })
    addToolset("files", { read: [FILES_READ], write: [] })

    const scopes = loginScopes(["notes", "files", "notes"], false)

    expect(scopes).toEqual([...new Set([OPENID_SCOPE, EMAIL_SCOPE, NOTES_READ, NOTES_WRITE, FILES_READ])].sort())
  })

  test("only the read scopes with readOnly", () => {
    addToolset("notes", { read: [NOTES_READ], write: [NOTES_WRITE] })

    expect(loginScopes(["notes"], true)).toEqual([OPENID_SCOPE, EMAIL_SCOPE, NOTES_READ].sort())
  })

  test("no toolset asks for the identity scopes alone", () => {
    expect(loginScopes([], false)).toEqual([OPENID_SCOPE, EMAIL_SCOPE].sort())
  })

  test("toolsetsFor names the toolsets that hold the first scope any toolset holds, in the table's order", () => {
    addToolset("notes", { read: [NOTES_READ], write: [NOTES_WRITE] })
    addToolset("files", { read: [FILES_READ], write: [] })
    addToolset("archive", { read: [], write: [NOTES_WRITE] })

    expect(toolsetsFor([FILES_READ, NOTES_WRITE])).toEqual(["files"])
    expect(toolsetsFor([NOTES_WRITE, FILES_READ])).toEqual(["notes", "archive"])
    expect(toolsetsFor(["https://www.example.test/auth/none", NOTES_READ, FILES_READ])).toEqual(["notes"])
    expect(toolsetsFor([NOTES_READ])).toEqual(["notes"])
    expect(toolsetsFor([OPENID_SCOPE, "https://www.example.test/auth/none"])).toEqual([])
    expect(toolsetsFor([])).toEqual([])
  })

  test("toolsetsFor names only the own toolset when it holds one of the scopes", () => {
    addToolset("notes", { read: [NOTES_READ], write: [NOTES_WRITE] })
    addToolset("files", { read: [FILES_READ], write: [] })
    addToolset("archive", { read: [], write: [NOTES_WRITE] })

    expect(toolsetsFor([NOTES_WRITE], "archive")).toEqual(["archive"])
    expect(toolsetsFor([FILES_READ, NOTES_WRITE], "archive")).toEqual(["archive"])
    expect(toolsetsFor([FILES_READ, NOTES_WRITE], "notes")).toEqual(["notes"])
    expect(toolsetsFor([FILES_READ, NOTES_WRITE], "files")).toEqual(["files"])
    expect(toolsetsFor([FILES_READ], "notes")).toEqual(["files"])
    expect(toolsetsFor([NOTES_WRITE, FILES_READ], "other")).toEqual(["notes", "archive"])
    expect(toolsetsFor([NOTES_WRITE], "toString")).toEqual(["notes", "archive"])
  })

  test("needsWrite is true only when no scope is a read scope, the identity scopes included", () => {
    addToolset("notes", { read: [NOTES_READ], write: [NOTES_WRITE] })

    expect(needsWrite([NOTES_WRITE])).toBe(true)
    expect(needsWrite([NOTES_READ, NOTES_WRITE])).toBe(false)
    expect(needsWrite([OPENID_SCOPE])).toBe(false)
    expect(needsWrite(["https://www.example.test/auth/none"])).toBe(true)
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
