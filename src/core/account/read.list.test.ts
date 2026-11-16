import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { symlink } from "node:fs/promises"
import { join } from "node:path"
import { CREDENTIAL, VARIABLE, toolError } from "../google/client.fixtures"
import { EMAIL_SCOPE, OPENID_SCOPE } from "../google/routes"
import { DRIVE_METADATA_READ_SCOPE } from "../sheets/scopes"
import { invoke } from "../tool"
import { googleAccountRead } from "./read"
import { CLI, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const LIST = { method: "list" }

describe("google_account_read list", () => {
  test("an empty state directory has no accounts", async () => {
    const h = await fixture()
    expect(await h.read(LIST)).toEqual({ accounts: [] })
  })

  test("reports each label, sorted, from its file or its variable, with the variable's name", async () => {
    const h = await fixture()
    await h.label("work", CREDENTIAL)
    await h.label("home")
    h.setVariable("home", { ...CREDENTIAL, email: "home@example.test" })

    const { accounts } = await h.read(LIST)
    expect(accounts).toEqual([
      {
        account: "home",
        source: "variable",
        variable: "GT_CREDENTIALS_HOME",
        email: "home@example.test",
        scopes: [EMAIL_SCOPE, OPENID_SCOPE],
        toolsets: ["account"],
        read_only_toolsets: [],
        problem: null,
        fix: null,
      },
      {
        account: "work",
        source: "file",
        variable: VARIABLE,
        email: CREDENTIAL.email,
        scopes: [EMAIL_SCOPE, OPENID_SCOPE],
        toolsets: ["account"],
        read_only_toolsets: [],
        problem: null,
        fix: null,
      },
    ])
  })

  test("never contacts Google", async () => {
    const h = await fixture([])
    await h.label("work", CREDENTIAL)
    await h.read(LIST)
    expect(h.requests).toEqual([])
  })

  test("the toolsets follow the scopes: no identity scopes cover no toolset", async () => {
    const h = await fixture()
    await h.label("work", { ...CREDENTIAL, scopes: [DRIVE_METADATA_READ_SCOPE] })
    const { accounts } = await h.read(LIST)
    expect(accounts?.[0]).toMatchObject({ scopes: [DRIVE_METADATA_READ_SCOPE], toolsets: [], read_only_toolsets: [] })
  })

  test("a label with no credential names the login command, and the OAuth client it needs", async () => {
    const h = await fixture()
    await h.label("work")
    const row = (await h.read(LIST)).accounts?.[0]
    expect(row).toMatchObject({ source: null, email: null, scopes: [], toolsets: [] })
    expect(row?.problem?.code).toBe("unauthenticated")
    expect(row?.problem?.message).toContain("No credential for Google account")
    expect(row?.fix).toStartWith(`${CLI} login --account work --toolsets account --state-dir `)
    expect(row?.fix).toEndWith(" --client <client-file>")
  })

  test("a credential file other users can read names the chmod that fixes it", async () => {
    const h = await fixture()
    const paths = await h.label("work")
    await h.writeFile(paths, JSON.stringify(CREDENTIAL), 0o644)
    const row = (await h.read(LIST)).accounts?.[0]
    expect(row).toMatchObject({ source: "file", email: null, scopes: [] })
    expect(row?.problem?.code).toBe("forbidden")
    expect(row?.fix).toBe(`chmod 600 ${JSON.stringify(paths.credentials)}`)
  })

  test("a link in place of the credential file is replaced by a login, not a chmod", async () => {
    const h = await fixture()
    const paths = await h.label("work")
    await symlink(join(h.stateDir, "elsewhere"), paths.credentials)
    const row = (await h.read(LIST)).accounts?.[0]
    expect(row?.source).toBe("file")
    expect(row?.problem?.code).toBe("forbidden")
    expect(row?.fix).toStartWith(`${CLI} login --account work `)
  })

  test("a file that is not a credential is a problem to log in over", async () => {
    const h = await fixture()
    await h.writeFile(await h.label("work"), "not json")
    const row = (await h.read(LIST)).accounts?.[0]
    expect(row).toMatchObject({ source: "file", problem: { code: "unauthenticated" } })
    expect(row?.fix).toStartWith(`${CLI} login --account work `)
  })

  test("a variable that is not a credential says to correct the variable, since login stores nothing then", async () => {
    const h = await fixture()
    await h.label("work")
    h.setVariable("work", "not json")
    const row = (await h.read(LIST)).accounts?.[0]
    expect(row).toMatchObject({ source: "variable", problem: { code: "unauthenticated" } })
    expect(row?.fix).toContain(VARIABLE)
    expect(row?.fix).not.toContain("login --account")
  })

  test("one unreadable label leaves the others reported", async () => {
    const h = await fixture()
    await h.label("a_broken")
    await h.label("work", CREDENTIAL)
    const { accounts } = await h.read(LIST)
    expect(accounts?.map((row) => [row.account, row.problem === null])).toEqual([
      ["a_broken", false],
      ["work", true],
    ])
  })

  test("takes no account", async () => {
    const h = await fixture()
    const error = await toolError(h.read({ ...LIST, account: "work" }))
    expect(error.code).toBe("invalid_argument")
  })

  test("a call without a runtime is an internal error", async () => {
    const h = await fixture()
    const error = await toolError(invoke(googleAccountRead, LIST, { cwd: h.stateDir, stateDir: h.stateDir }))
    expect(error.code).toBe("internal_error")
  })
})
