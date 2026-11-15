import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } from "./client.fixtures"
import { runConsent } from "./consent"
import { AUTH_CODE, EMAIL, SCOPES, consentOptions, idToken, tokenEndpoint, until, visit } from "./consent.testing"

const BASE64URL = /^[A-Za-z0-9_-]+$/

describe("runConsent", () => {
  test("opens the authorization URL with PKCE, offline access and a state, and returns the tokens", async () => {
    const run = consentOptions([tokenEndpoint({ scope: SCOPES.join(" ") })])

    const result = await runConsent(run.options)

    expect(result).toEqual({ refresh_token: REFRESH_TOKEN, scopes: SCOPES, email: EMAIL })
    const url = new URL(run.opened[0]!)
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    const query = url.searchParams
    expect(query.get("client_id")).toBe(CLIENT_ID)
    expect(query.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(query.get("response_type")).toBe("code")
    expect(query.get("scope")).toBe(SCOPES.join(" "))
    expect(query.get("access_type")).toBe("offline")
    expect(query.get("prompt")).toBe("consent")
    expect(query.get("code_challenge_method")).toBe("S256")
    expect(query.get("state")).toMatch(BASE64URL)
    expect(query.get("state")!.length).toBeGreaterThanOrEqual(43)
    expect(query.has("login_hint")).toBe(false)
  })

  test("tells the person the URL first, then opens it", async () => {
    const run = consentOptions()

    await runConsent(run.options)

    expect(run.notices).toHaveLength(1)
    expect(run.notices[0]).toContain(run.opened[0]!)
  })

  test("exchanges the code with the verifier whose S256 challenge the URL carried", async () => {
    const run = consentOptions()

    await runConsent(run.options)

    const [exchange] = run.requests
    expect(exchange!.url.toString()).toBe("https://oauth2.googleapis.com/token")
    const form = exchange!.form!
    const url = new URL(run.opened[0]!)
    expect(form.grant_type).toBe("authorization_code")
    expect(form.code).toBe(AUTH_CODE)
    expect(form.client_id).toBe(CLIENT_ID)
    expect(form.client_secret).toBe(CLIENT_SECRET)
    expect(form.redirect_uri).toBe(url.searchParams.get("redirect_uri")!)
    expect(form.code_verifier!.length).toBeGreaterThanOrEqual(43)
    expect(form.code_verifier!.length).toBeLessThanOrEqual(128)
    expect(form.code_verifier).toMatch(BASE64URL)
    const challenge = createHash("sha256").update(form.code_verifier!).digest("base64url")
    expect(url.searchParams.get("code_challenge")).toBe(challenge)
  })

  test("each run has its own state and verifier", async () => {
    const first = consentOptions()
    const second = consentOptions()

    await runConsent(first.options)
    await runConsent(second.options)

    const state = (run: typeof first) => new URL(run.opened[0]!).searchParams.get("state")
    expect(state(first)).not.toBe(state(second))
    expect(first.requests[0]!.form!.code_verifier).not.toBe(second.requests[0]!.form!.code_verifier)
  })

  test("a login hint preselects the account", async () => {
    const run = consentOptions(undefined, undefined, { loginHint: EMAIL })

    await runConsent(run.options)

    expect(new URL(run.opened[0]!).searchParams.get("login_hint")).toBe(EMAIL)
  })

  test("answers the browser with a plain page and stops listening", async () => {
    let page = ""
    let redirectUri = ""
    const run = consentOptions(undefined, async (url) => {
      const target = new URL(url).searchParams
      redirectUri = target.get("redirect_uri")!
      page = (await visit(redirectUri, { state: target.get("state")!, code: AUTH_CODE })).body
    })

    await runConsent(run.options)
    await until(() => page !== "")

    expect(page).toContain("Logged in; you can close this tab.")
    await expect(visit(redirectUri, {})).rejects.toThrow()
  })

  test("the granted scopes are the reply's, which may be fewer than asked", async () => {
    const run = consentOptions([tokenEndpoint({ scope: "openid" })])

    expect((await runConsent(run.options)).scopes).toEqual(["openid"])
  })
})

describe("the address of the account", () => {
  async function emailFor(reply: Record<string, unknown>): Promise<string | null> {
    return (await runConsent(consentOptions([tokenEndpoint(reply)]).options)).email
  }

  test("comes from the ID token's payload", async () => {
    expect(await emailFor({ id_token: idToken({ email: EMAIL, email_verified: true }) })).toBe(EMAIL)
  })

  test.each([
    ["an address that is not verified", { id_token: idToken({ email: EMAIL, email_verified: false }) }],
    ["an address that is not a string", { id_token: idToken({ email: 7 }) }],
    ["a payload without an address", { id_token: idToken({ sub: "1" }) }],
    ["a payload that is not JSON", { id_token: "aaa.bbb.ccc" }],
    ["a token without a payload", { id_token: "aaa" }],
    ["no ID token", { id_token: undefined }],
  ])("is null for %s", async (_name, reply) => {
    expect(await emailFor(reply)).toBeNull()
  })
})

describe("what the exchange fails with", () => {
  test("no refresh token is upstream_error", async () => {
    const run = consentOptions([tokenEndpoint({ refresh_token: undefined })])

    const error = await runConsent(run.options).catch((caught: unknown) => caught as Error & { code: string })

    expect(error).toMatchObject({ code: "upstream_error" })
    expect((error as Error).message).toContain("Google returned no refresh token;")
  })

  test("a refusal of the code is Google's message with the code, verifier and secret masked", async () => {
    const run = consentOptions([
      {
        method: "POST",
        url: "https://oauth2.googleapis.com/token",
        reply: (request) => ({
          status: 400,
          json: {
            error: "invalid_grant",
            error_description: `bad ${request.form!.code} ${request.form!.code_verifier} ${CLIENT_SECRET}`,
          },
        }),
      },
    ])

    const error = await runConsent(run.options).catch((caught: unknown) => caught as Error & { code: string })

    expect(error).toMatchObject({ code: "unauthenticated" })
    const { message } = error as Error
    for (const secret of [AUTH_CODE, run.requests[0]!.form!.code_verifier!, CLIENT_SECRET]) {
      expect(message).not.toContain(secret)
    }
  })
})
