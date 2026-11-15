import { request } from "node:http"
import { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, TOKEN_URL } from "./client.fixtures"
import type { ConsentOptions } from "./consent"
import { fakeGoogle, tokenReply, type FakeHandler, type FakeRequest } from "./fake-google.testing"

/** Made-up values the consent tests share. */
export const AUTH_CODE = "4/made-up-authorization-code-0001"
export const EMAIL = "someone@example.test"
export const SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]

/** What a visit to the redirect address got back. */
export type Visit = { status: number; body: string }

/** An unsigned ID token carrying `claims`, as made up for a test; no signature is checked. */
export function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${part({ alg: "none" })}.${part(claims)}.`
}

/** What the browser does on the redirect address: a request with `method` to `path` and `params`. */
export function visit(
  redirectUri: string,
  params: Record<string, string>,
  options: { method?: string; path?: string } = {},
): Promise<Visit> {
  const { method = "GET", path = "/" } = options
  return new Promise((resolve, reject) => {
    const call = request(`${redirectUri}${path}?${new URLSearchParams(params)}`, { method, agent: false }, (reply) => {
      let body = ""
      reply.setEncoding("utf8").on("data", (chunk: string) => (body += chunk))
      reply.on("end", () => resolve({ status: reply.statusCode ?? 0, body }))
    })
    call.on("error", reject)
    call.end()
  })
}

/** The redirect address and the `state` the consent URL carries. */
export function targetOf(url: string): { redirectUri: string; state: string } {
  const { searchParams } = new URL(url)
  return { redirectUri: searchParams.get("redirect_uri")!, state: searchParams.get("state")! }
}

/** The token endpoint of a fake Google, answering with a refresh token and an ID token unless told otherwise. */
export function tokenEndpoint(reply: Record<string, unknown> = {}, status = 200): FakeHandler {
  return {
    method: "POST",
    url: TOKEN_URL,
    reply: {
      status,
      json: tokenReply({ refresh_token: REFRESH_TOKEN, id_token: idToken({ email: EMAIL }), ...reply }),
    },
  }
}

/** Waits until `check` holds, polling every few milliseconds. */
export async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; !check(); attempt++) {
    if (attempt > 2000) throw new Error("timed out waiting")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** What a consent run under test recorded. */
export type Consent = {
  options: ConsentOptions
  notices: string[]
  opened: string[]
  requests: FakeRequest[]
}

/**
 * Options for `runConsent` against a fake Google. `openBrowser` defaults to a
 * browser that approves the consent with `AUTH_CODE`; `act` replaces what it
 * does with the consent URL.
 */
export function consentOptions(
  handlers: FakeHandler[] = [tokenEndpoint()],
  act: (url: string) => Promise<unknown> = async (url) => {
    const { redirectUri, state } = targetOf(url)
    await visit(redirectUri, { state, code: AUTH_CODE })
  },
  overrides: Partial<ConsentOptions> = {},
): Consent {
  const google = fakeGoogle(handlers)
  const notices: string[] = []
  const opened: string[] = []
  const options: ConsentOptions = {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: SCOPES,
    fetch: google.fetch,
    openBrowser: async (url) => {
      opened.push(url)
      await act(url)
    },
    notify: (text) => notices.push(text),
    ...overrides,
  }
  return { options, notices, opened, requests: google.requests }
}
