import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { CLIENT_SECRET, REFRESH_TOKEN, TOKEN_URL, makeLabel, storeCredential, toolError } from "./client.fixtures"
import { fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { TokenSource, clearTokenCache, postOAuth } from "./token"

const CODE = "madeUpAuthorizationCode-FFFF1234"
const VERIFIER = "madeUpVerifier-GGGG1234567890"

let stateDir: string
let paths: LabelPaths

beforeEach(async () => {
  clearTokenCache()
  ;({ stateDir, paths } = await makeLabel())
  await storeCredential(paths)
})

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true })
})

function sourceOver(handler: FakeHandler["reply"]) {
  const google = fakeGoogle([{ method: "POST", url: TOKEN_URL, reply: handler }])
  return new TokenSource({ paths, variable: "GT_CREDENTIALS_WORK", env: {}, fetch: google.fetch })
}

function expectNoSecrets(error: Error) {
  const text = JSON.stringify({ message: error.message, details: (error as { details?: unknown }).details })
  expect(text).not.toContain(REFRESH_TOKEN)
  expect(text).not.toContain(CLIENT_SECRET)
}

describe("masking in refresh failures", () => {
  test("an error body that echoes the refresh token and client secret is masked", async () => {
    const source = sourceOver({
      status: 400,
      json: {
        error: { message: `bad ${REFRESH_TOKEN} with ${CLIENT_SECRET}`, errors: [{ reason: REFRESH_TOKEN }] },
      },
    })
    const error = await toolError(source.accessToken())
    expectNoSecrets(error)
    expect(error.message).toBe(`Google: bad ${MASK} with ${MASK}`)
    expect(error.details).toEqual({ status: 400, reason: MASK })
  })

  test("an OAuth error that echoes them is masked", async () => {
    const source = sourceOver({
      status: 401,
      json: { error: "invalid_client", error_description: `client ${CLIENT_SECRET} for ${REFRESH_TOKEN}` },
    })
    const error = await toolError(source.accessToken())
    expectNoSecrets(error)
    expect(error.code).toBe("unauthenticated")
  })

  test("invalid_grant does not repeat Google's text at all", async () => {
    const source = sourceOver({
      status: 400,
      json: { error: "invalid_grant", error_description: `gone ${REFRESH_TOKEN}` },
    })
    const error = await toolError(source.accessToken())
    expectNoSecrets(error)
    expect(error.message).not.toContain("gone")
  })

  test("a network failure that names the secrets is masked", async () => {
    const google = fakeGoogle([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: () => {
          throw new Error(`connect failed for ${REFRESH_TOKEN} ${CLIENT_SECRET}`)
        },
      },
    ])
    const source = new TokenSource({ paths, variable: "X", env: {}, fetch: google.fetch })
    const error = await toolError(source.accessToken())
    expect(error.code).toBe("upstream_error")
    expectNoSecrets(error)
  })

  test("a malformed success reply is not echoed", async () => {
    const source = sourceOver({ json: { access_token: "", marker: REFRESH_TOKEN, extra: tokenReply() } })
    const error = await toolError(source.accessToken())
    expect(error.code).toBe("upstream_error")
    expect(error.message).not.toContain(REFRESH_TOKEN)
  })
})

describe("postOAuth", () => {
  test("masks the code, the verifier and the revoked token in a failure", async () => {
    const google = fakeGoogle([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: { status: 400, json: { error: "invalid_request", error_description: `${CODE} ${VERIFIER}` } },
      },
    ])
    const error = await toolError(
      postOAuth(
        google.fetch,
        "token",
        { grant_type: "authorization_code", code: CODE, code_verifier: VERIFIER },
        { timeoutMs: 1000 },
      ),
    )
    expect(error.message).toBe(`Google: invalid_request: ${MASK} ${MASK}`)
  })

  test("revoke posts the token and an empty reply is {}", async () => {
    const google = fakeGoogle([{ method: "POST", url: "https://oauth2.googleapis.com/revoke", reply: { status: 200 } }])
    expect(await postOAuth(google.fetch, "revoke", { token: REFRESH_TOKEN }, { timeoutMs: 1000 })).toEqual({})
    expect(google.requests[0]?.form).toEqual({ token: REFRESH_TOKEN })
  })

  test("a time limit passed is upstream_error", async () => {
    const google = fakeGoogle([{ method: "POST", url: TOKEN_URL, reply: () => new Promise(() => {}) }])
    const error = await toolError(postOAuth(google.fetch, "token", { grant_type: "x" }, { timeoutMs: 20 }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google did not answer within 0.02 s")
  })
})
