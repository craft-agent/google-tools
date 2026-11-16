import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CREDENTIAL, TOKEN_URL, USERINFO_URL, VARIABLE, toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { EMAIL_SCOPE, OPENID_SCOPE } from "../google/routes"
import { DRIVE_METADATA_READ_SCOPE } from "../sheets/scopes"
import { CLI, EMAIL_NOW, cleanUp, fixture, freshTokens, tokenHandler, userinfoHandler } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const CHECK = { method: "check" }

const refusedToken: FakeHandler = {
  method: "POST",
  url: TOKEN_URL,
  reply: { status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
}

describe("google_account_read check", () => {
  test("refreshes the token, asks Google and compares the address with the recorded one", async () => {
    const h = await fixture()
    await h.label("work", CREDENTIAL)
    expect(await h.read(CHECK)).toEqual({
      check: {
        account: "work",
        source: "file",
        email_recorded: CREDENTIAL.email,
        email_now: EMAIL_NOW,
        matches: true,
        scopes: [EMAIL_SCOPE, OPENID_SCOPE],
        toolsets: ["account"],
        read_only_toolsets: [],
        ok: true,
        problem: null,
        fix: null,
      },
    })
    expect(h.requests.map((request) => `${request.method} ${request.url.origin}${request.url.pathname}`)).toEqual([
      `POST ${TOKEN_URL}`,
      `GET ${USERINFO_URL}`,
    ])
  })

  test("the addresses match whatever their case", async () => {
    const h = await fixture([tokenHandler, userinfoHandler("SomeOne@Example.test")])
    await h.label("work", CREDENTIAL)
    expect((await h.read(CHECK)).check).toMatchObject({ email_now: "SomeOne@Example.test", matches: true })
  })

  test("another address than the recorded one is reported, not failed", async () => {
    const h = await fixture([tokenHandler, userinfoHandler("other@example.test")])
    await h.label("work", CREDENTIAL)
    expect((await h.read(CHECK)).check).toMatchObject({ ok: true, email_now: "other@example.test", matches: false })
  })

  test("with no address recorded the comparison is unknown", async () => {
    const h = await fixture()
    await h.label("work", { ...CREDENTIAL, email: null })
    expect((await h.read(CHECK)).check).toMatchObject({ ok: true, email_recorded: null, matches: null })
  })

  test("reads the credential from the variable", async () => {
    const h = await fixture()
    await h.label("work")
    h.setVariable("work", CREDENTIAL)
    expect((await h.read(CHECK)).check).toMatchObject({ ok: true, source: "variable" })
  })

  test("a credential Google refuses is returned as a problem with the login to run", async () => {
    const h = await fixture([refusedToken])
    await h.label("work", CREDENTIAL)
    const { check } = await h.read(CHECK)
    expect(check).toMatchObject({ ok: false, email_now: null, matches: null, email_recorded: CREDENTIAL.email })
    expect(check?.problem).toMatchObject({ code: "unauthenticated" })
    expect(check?.problem?.message).toContain("Google refused the credential")
    expect(check?.fix).toStartWith(`${CLI} login --account work --toolsets account --state-dir `)
    expect(check?.fix).not.toContain("--client")
  })

  test("a refused credential in a variable says to correct the variable", async () => {
    const h = await fixture([refusedToken])
    await h.label("work")
    h.setVariable("work", CREDENTIAL)
    const { check } = await h.read(CHECK)
    expect(check).toMatchObject({ ok: false, source: "variable" })
    expect(check?.fix).toContain(VARIABLE)
  })

  test("a label without the identity scopes fails before Google is called", async () => {
    const h = await fixture()
    await h.label("work", { ...CREDENTIAL, scopes: [DRIVE_METADATA_READ_SCOPE] })
    const { check } = await h.read(CHECK)
    expect(check).toMatchObject({ ok: false, toolsets: [], scopes: [DRIVE_METADATA_READ_SCOPE] })
    expect(check?.problem?.message).toContain("was not logged in with a scope this call needs")
    expect(check?.fix).toStartWith(`${CLI} login --account work --toolsets account `)
    expect(h.requests).toEqual([])
  })

  test("a label with no readable credential is returned as a problem too", async () => {
    const h = await fixture()
    await h.label("work")
    const { check } = await h.read(CHECK)
    expect(check).toMatchObject({ ok: false, source: null, email_recorded: null, scopes: [] })
    expect(check?.fix).toEndWith(" --client <client-file>")
    expect(h.requests).toEqual([])
  })

  test("a failure that is not a refusal of the credential is thrown", async () => {
    const h = await fixture([tokenHandler, { method: "GET", url: USERINFO_URL, reply: { status: 500, text: "down" } }])
    await h.label("work", CREDENTIAL)
    expect((await toolError(h.read(CHECK))).code).toBe("upstream_error")
  })

  test("with several accounts the label must be named", async () => {
    const h = await fixture()
    await h.label("home", CREDENTIAL)
    await h.label("work", CREDENTIAL)
    const error = await toolError(h.read(CHECK))
    expect(error.code).toBe("invalid_argument")
    expect(error.details).toEqual({ known_accounts: ["home", "work"] })
    expect((await h.read({ ...CHECK, account: "work" })).check?.account).toBe("work")
  })

  test("an unknown account is not found, and none set up is too", async () => {
    const h = await fixture()
    expect((await toolError(h.read(CHECK))).code).toBe("not_found")
    await h.label("work", CREDENTIAL)
    expect((await toolError(h.read({ ...CHECK, account: "other" }))).code).toBe("not_found")
  })
})
