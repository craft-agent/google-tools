import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import {
  CLIENT_ID,
  CLIENT_SECRET,
  CREDENTIAL,
  DRIVE_SCOPE,
  REFRESH_TOKEN,
  TOKEN_URL,
  VARIABLE,
  makeLabel,
  storeCredential,
  toolError,
  variableEnv,
} from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { TokenSource, clearTokenCache, forgetAccessToken, parseTokenReply } from "./token"

const MINUTE_MS = 60_000

let stateDir: string
let paths: LabelPaths

beforeEach(async () => {
  clearTokenCache()
  ;({ stateDir, paths } = await makeLabel())
})

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true })
})

function sourceOver(
  handlers: Parameters<typeof fakeGoogle>[0],
  options: { now?: () => number; env?: Record<string, string> } = {},
) {
  const google = fakeGoogle(handlers)
  const source = new TokenSource({
    paths,
    variable: VARIABLE,
    env: options.env ?? {},
    fetch: google.fetch,
    now: options.now,
  })
  return { source, requests: google.requests }
}

describe("TokenSource.accessToken", () => {
  test("refreshes with the credential's refresh token and client over a form POST", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    const grant = await source.accessToken()
    expect(grant.token).toBe(FAKE_ACCESS_TOKEN)
    expect(grant.source).toBe("file")
    expect(grant.credential).toEqual(CREDENTIAL)
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request?.headers["content-type"]).toBe("application/x-www-form-urlencoded")
    expect(request?.form).toEqual({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
  })

  test("a second call uses the cached token without another POST", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    await source.accessToken()
    expect((await source.accessToken()).token).toBe(FAKE_ACCESS_TOKEN)
    expect(requests).toHaveLength(1)
  })

  test("the cache is per process: another source over the same label shares it", async () => {
    await storeCredential(paths)
    const first = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    await first.source.accessToken()
    const second = sourceOver([])
    expect((await second.source.accessToken()).token).toBe(FAKE_ACCESS_TOKEN)
    expect(second.requests).toHaveLength(0)
  })

  test("refreshes again once less than a minute is left", async () => {
    await storeCredential(paths)
    let clock = 1_000_000
    const { source, requests } = sourceOver(
      [{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply({ expires_in: 3600 }) } }],
      { now: () => clock },
    )
    await source.accessToken()
    clock += 3600 * 1000 - MINUTE_MS - 1
    await source.accessToken()
    expect(requests).toHaveLength(1)
    clock += 1
    await source.accessToken()
    expect(requests).toHaveLength(2)
  })

  test("forgetAccessToken makes the next call refresh", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    await source.accessToken()
    forgetAccessToken(paths, REFRESH_TOKEN)
    await source.accessToken()
    expect(requests).toHaveLength(2)
  })

  test("a new login is seen on the next call: its refresh token has no cache entry", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    await source.accessToken()
    await storeCredential(paths, { ...CREDENTIAL, refresh_token: "madeUpOtherLogin-DDDD0123456789" })
    await source.accessToken()
    expect(requests.map((request) => request.form?.refresh_token)).toEqual([
      REFRESH_TOKEN,
      "madeUpOtherLogin-DDDD0123456789",
    ])
  })

  test("concurrent calls in one process share one refresh", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    const grants = await Promise.all([source.accessToken(), source.accessToken(), source.accessToken()])
    expect(grants.map((grant) => grant.token)).toEqual([FAKE_ACCESS_TOKEN, FAKE_ACCESS_TOKEN, FAKE_ACCESS_TOKEN])
    expect(requests).toHaveLength(1)
  })

  test("a variable credential refreshes even when the label has no directory", async () => {
    await rm(paths.dir, { recursive: true })
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }], {
      env: variableEnv(),
    })
    const grant = await source.accessToken()
    expect(grant.source).toBe("variable")
    expect(requests).toHaveLength(1)
  })

  test("a missing credential fails before any request", async () => {
    const { source, requests } = sourceOver([])
    expect((await toolError(source.accessToken())).code).toBe("unauthenticated")
    expect(requests).toHaveLength(0)
  })

  test("a cancelled signal fails as upstream_error", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }])
    const controller = new AbortController()
    controller.abort()
    expect((await toolError(source.accessToken(controller.signal))).code).toBe("upstream_error")
    expect(requests).toHaveLength(0)
  })
})

describe("TokenSource.accessToken when Google refuses", () => {
  test("invalid_grant is unauthenticated naming the account, and drops the cache", async () => {
    await storeCredential(paths)
    let revoked = false
    const { source, requests } = sourceOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: () =>
          revoked
            ? { status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }
            : { json: tokenReply({ expires_in: 10 }) },
      },
    ])
    await source.accessToken()
    revoked = true
    const error = await toolError(source.accessToken())
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(
      'Google refused the credential of account "work"; it was revoked or expired. Log the account in again.',
    )
    expect(error.details).toEqual({ account: "work", reason: "invalid_grant" })
    revoked = false
    await source.accessToken()
    expect(requests).toHaveLength(3)
  })

  test("another failure keeps its mapped code", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([
      { method: "POST", url: TOKEN_URL, reply: { status: 503, json: { error: { message: "down" } } } },
    ])
    const error = await toolError(source.accessToken())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google: down")
  })

  test("a redirect is not followed", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([
      { method: "POST", url: TOKEN_URL, reply: { status: 302, headers: { location: "https://elsewhere.test/" } } },
    ])
    const error = await toolError(source.accessToken())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
    expect(requests).toHaveLength(1)
  })
})

describe("parseTokenReply", () => {
  test("keeps the checked fields and splits the scope", () => {
    const reply = parseTokenReply(tokenReply({ scope: "a  b\nc", refresh_token: "r", id_token: "i" }), [DRIVE_SCOPE])
    expect(reply).toEqual({
      access_token: FAKE_ACCESS_TOKEN,
      expires_in: 3599,
      scope: ["a", "b", "c"],
      refresh_token: "r",
      id_token: "i",
    })
  })

  test("a missing scope falls back to the credential's", () => {
    expect(parseTokenReply(tokenReply({ scope: undefined }), [DRIVE_SCOPE]).scope).toEqual([DRIVE_SCOPE])
  })

  test.each([
    ["not an object", "text"],
    ["null", null],
    ["an array", []],
    ["no access_token", tokenReply({ access_token: undefined })],
    ["an empty access_token", tokenReply({ access_token: "" })],
    ["a numeric access_token", tokenReply({ access_token: 5 })],
    ["no expires_in", tokenReply({ expires_in: undefined })],
    ["a string expires_in", tokenReply({ expires_in: "3600" })],
    ["a zero expires_in", tokenReply({ expires_in: 0 })],
    ["a negative expires_in", tokenReply({ expires_in: -5 })],
    ["an infinite expires_in", tokenReply({ expires_in: Infinity })],
    ["a numeric scope", tokenReply({ scope: 5 })],
    ["an empty refresh_token", tokenReply({ refresh_token: "" })],
    ["a numeric id_token", tokenReply({ id_token: 7 })],
  ])("refuses %s as upstream_error without echoing it", (_name, body) => {
    try {
      parseTokenReply(body, [])
    } catch (error) {
      expect((error as { code?: string }).code).toBe("upstream_error")
      expect((error as Error).message).not.toContain(FAKE_ACCESS_TOKEN)
      return
    }
    throw new Error("expected a failure")
  })

  test("a malformed reply through the source is upstream_error", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { json: { access_token: "" } } }])
    expect((await toolError(source.accessToken())).code).toBe("upstream_error")
  })

  test("a reply that is not JSON is upstream_error", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([{ method: "POST", url: TOKEN_URL, reply: { text: "<html>" } }])
    expect((await toolError(source.accessToken())).code).toBe("upstream_error")
  })
})
