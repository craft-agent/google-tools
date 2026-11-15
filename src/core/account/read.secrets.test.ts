import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CLIENT_ID, CLIENT_SECRET, CREDENTIAL, REFRESH_TOKEN, TOKEN_URL, USERINFO_URL } from "../google/client.fixtures"
import { FAKE_ACCESS_TOKEN, tokenReply, type FakeHandler } from "../google/fake-google.testing"
import { cleanUp, fixture, freshTokens, tokenHandler, userinfoHandler } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SECRETS = [REFRESH_TOKEN, CLIENT_SECRET, CLIENT_ID, FAKE_ACCESS_TOKEN]

function expectNoSecrets(result: unknown): void {
  const text = JSON.stringify(result)
  for (const secret of SECRETS) expect(text).not.toContain(secret)
}

/** Google answers the userinfo call with an error that echoes the tokens it was sent. */
const echoingUserinfo: FakeHandler = {
  method: "GET",
  url: USERINFO_URL,
  reply: {
    status: 401,
    json: { error: { status: "UNAUTHENTICATED", message: `rejected ${FAKE_ACCESS_TOKEN} and ${REFRESH_TOKEN}` } },
  },
}

describe("google_account_read results", () => {
  test("a list carries no token, secret or client id, from a file or a variable", async () => {
    const h = await fixture()
    await h.label("work", CREDENTIAL)
    await h.label("home")
    h.setVariable("home", CREDENTIAL)
    const result = await h.read({ method: "list" })
    expect(result.accounts).toHaveLength(2)
    expectNoSecrets(result)
  })

  test("a list of a variable that is not a credential does not echo what it holds", async () => {
    const h = await fixture()
    await h.label("work")
    h.setVariable("work", { ...CREDENTIAL, client_id: "" })
    const result = await h.read({ method: "list" })
    expect(result.accounts?.[0]?.problem?.code).toBe("unauthenticated")
    expectNoSecrets(result)
  })

  test("a successful check carries none, though Google's answer holds the client id", async () => {
    const h = await fixture([tokenHandler, userinfoHandler()])
    await h.label("work", CREDENTIAL)
    const result = await h.read({ method: "check" })
    expect(result.check?.ok).toBe(true)
    expectNoSecrets(result)
  })

  test("a refused check carries none, though Google's error echoes the tokens", async () => {
    const h = await fixture([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }, echoingUserinfo])
    await h.label("work", CREDENTIAL)
    const result = await h.read({ method: "check" })
    expect(result.check).toMatchObject({ ok: false, problem: { code: "unauthenticated" } })
    expect(result.check?.problem?.message).toContain("[masked]")
    expectNoSecrets(result)
  })

  test("an address that holds a credential is masked", async () => {
    const h = await fixture([tokenHandler, userinfoHandler(`${REFRESH_TOKEN}@example.test`)])
    await h.label("work", CREDENTIAL)
    const result = await h.read({ method: "check" })
    expect(result.check?.email_now).toBe("[masked]@example.test")
    expectNoSecrets(result)
  })
})
