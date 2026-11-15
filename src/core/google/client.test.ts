import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { GoogleClient, type MissingScopeFix } from "./client"
import {
  CREDENTIAL,
  DRIVE_SCOPE,
  TOKEN_URL,
  USERINFO_URL,
  VARIABLE,
  makeLabel,
  storeCredential,
  toolError,
  variableEnv,
} from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { EMAIL_SCOPE, HOSTS, OAUTH_ROUTES, OPENID_SCOPE, type Route } from "./routes"
import { clearTokenCache } from "./token"

const GET_ROUTE: Route = OAUTH_ROUTES.userinfo
const POST_ROUTE: Route = { ...OAUTH_ROUTES.userinfo, method: "POST" }
const OPEN_ROUTE: Route = { ...OAUTH_ROUTES.userinfo, scopes: [] }
const PARAM_ROUTE: Route = { ...OAUTH_ROUTES.userinfo, path: "/v1/userinfo/{id}" }
const REPLY = { json: { id: "abc", name: "notes" } }

const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }
const infoHandler: FakeHandler = { method: "GET", url: USERINFO_URL, reply: REPLY }

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

function clientOver(
  handlers: FakeHandler[],
  options: { env?: Record<string, string>; missingScopeFix?: MissingScopeFix } = {},
) {
  const google = fakeGoogle(handlers)
  const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch, ...options })
  return { client, requests: google.requests }
}

function callsTo<T extends { url: URL }>(requests: T[], host: string): T[] {
  return requests.filter((request) => request.url.host === host)
}

describe("GoogleClient.request", () => {
  test("sends the access token as a bearer with Accept, and returns the JSON", async () => {
    const { client, requests } = clientOver([tokenHandler, infoHandler])
    expect(await client.request(GET_ROUTE)).toEqual(REPLY.json)
    const [call] = callsTo(requests, "openidconnect.googleapis.com")
    expect(call?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
    expect(call?.headers.accept).toBe("application/json")
    expect(call?.body).toBeUndefined()
  })

  test("fills the path params", async () => {
    const { client, requests } = clientOver([
      tokenHandler,
      { method: "GET", url: `${USERINFO_URL}/a%20b`, reply: REPLY },
    ])
    await client.request(PARAM_ROUTE, { params: { id: "a b" } })
    expect(requests.at(-1)?.url.pathname).toBe("/v1/userinfo/a%20b")
  })

  test("sends the query, a JSON body with its content type and extra headers", async () => {
    const { client, requests } = clientOver([
      tokenHandler,
      { method: "POST", url: USERINFO_URL, reply: { status: 201, json: { ok: true } } },
    ])
    const reply = await client.request(POST_ROUTE, {
      query: { fields: "id", skip: undefined },
      body: { name: "x" },
      headers: { "If-Match": "etag-1", authorization: "Bearer attacker" },
    })
    expect(reply).toEqual({ ok: true })
    const call = requests.at(-1)
    expect(call?.url.search).toBe("?fields=id")
    expect(call?.json).toEqual({ name: "x" })
    expect(call?.headers["content-type"]).toBe("application/json")
    expect(call?.headers["if-match"]).toBe("etag-1")
    expect(call?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
  })

  test("an empty reply, such as 204, is {}", async () => {
    const { client } = clientOver([tokenHandler, { method: "GET", url: USERINFO_URL, reply: { status: 204 } }])
    expect(await client.request(GET_ROUTE)).toEqual({})
  })

  test("the access token is reused across calls", async () => {
    const { client, requests } = clientOver([tokenHandler, infoHandler])
    await client.request(GET_ROUTE)
    await client.request(GET_ROUTE)
    expect(callsTo(requests, "oauth2.googleapis.com")).toHaveLength(1)
  })

  test("a route off the allowlist fails as internal_error before any request", async () => {
    const { client, requests } = clientOver([tokenHandler])
    const route: Route = { method: "GET", host: "evil.test", path: "/x", scopes: [] }
    expect(HOSTS).not.toContain("evil.test")
    expect((await toolError(client.request(route))).code).toBe("internal_error")
    expect(requests).toHaveLength(0)
  })

  test("a bad path param fails as invalid_argument before any request", async () => {
    const { client, requests } = clientOver([tokenHandler])
    expect((await toolError(client.request(PARAM_ROUTE, { params: { id: "../x" } }))).code).toBe("invalid_argument")
    expect(requests).toHaveLength(0)
  })
})

describe("GoogleClient scope check", () => {
  test("refuses a route whose scopes the label lacks, before any request", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [DRIVE_SCOPE] })
    const { client, requests } = clientOver([tokenHandler, infoHandler])
    const error = await toolError(client.request(GET_ROUTE))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(
      `Google account "work" was not logged in with a scope this call needs (${OPENID_SCOPE} or ${EMAIL_SCOPE}). Log it in again with the toolsets that need it.`,
    )
    expect(error.details).toEqual({ account: "work", needs: [OPENID_SCOPE, EMAIL_SCOPE] })
    expect(requests).toHaveLength(0)
  })

  test("requireScopes refuses the same way without sending a request, and passes when the label holds a scope", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [DRIVE_SCOPE] })
    const { client, requests } = clientOver([tokenHandler, infoHandler])
    const error = await toolError(client.requireScopes(GET_ROUTE))
    expect(error.code).toBe("unauthenticated")
    expect(error.details).toEqual({ account: "work", needs: [OPENID_SCOPE, EMAIL_SCOPE] })
    await client.requireScopes(OPEN_ROUTE)

    await storeCredential(paths, { ...CREDENTIAL, scopes: [OPENID_SCOPE] })
    await client.requireScopes(GET_ROUTE)
    expect(requests).toHaveLength(0)
  })

  test("with a missingScopeFix, the message ends with the fix and details carry it", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [DRIVE_SCOPE] })
    const seen: { needs: readonly string[]; scopes: readonly string[] }[] = []
    const { client, requests } = clientOver([tokenHandler, infoHandler], {
      missingScopeFix: (needs, credential) => {
        seen.push({ needs, scopes: credential.scopes })
        return "gt login --account work"
      },
    })
    const error = await toolError(client.request(GET_ROUTE))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(
      `Google account "work" was not logged in with a scope this call needs (${OPENID_SCOPE} or ${EMAIL_SCOPE}). Ask a person to log it in again with: gt login --account work`,
    )
    expect(error.details).toEqual({
      account: "work",
      needs: [OPENID_SCOPE, EMAIL_SCOPE],
      fix: "gt login --account work",
    })
    expect(seen).toEqual([{ needs: [OPENID_SCOPE, EMAIL_SCOPE], scopes: [DRIVE_SCOPE] }])
    expect(requests).toHaveLength(0)
  })

  test("a missingScopeFix is not asked when the label holds a scope the route takes", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [OPENID_SCOPE] })
    const { client } = clientOver([tokenHandler, infoHandler], {
      missingScopeFix: () => {
        throw new Error("must not be asked")
      },
    })
    expect(await client.request(GET_ROUTE)).toEqual(REPLY.json)
  })

  test("accepts a label holding any one of the route's scopes", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [OPENID_SCOPE] })
    const { client } = clientOver([tokenHandler, infoHandler])
    expect(await client.request(GET_ROUTE)).toEqual(REPLY.json)
  })

  test("a route with no scopes needs none", async () => {
    await storeCredential(paths, { ...CREDENTIAL, scopes: [] })
    const { client } = clientOver([tokenHandler, infoHandler])
    expect(await client.request(OPEN_ROUTE)).toEqual(REPLY.json)
  })

  test("a credential from the variable is checked too", async () => {
    const { client, requests } = clientOver([tokenHandler], { env: variableEnv({ ...CREDENTIAL, scopes: [] }) })
    expect((await toolError(client.request(GET_ROUTE))).code).toBe("unauthenticated")
    expect(requests).toHaveLength(0)
  })

  test("a missing credential fails before any request", async () => {
    await rm(paths.credentials)
    const { client, requests } = clientOver([tokenHandler])
    expect((await toolError(client.request(GET_ROUTE))).code).toBe("unauthenticated")
    expect(requests).toHaveLength(0)
  })
})

describe("GoogleClient on a 401", () => {
  test("forgets the token and retries once with a fresh one", async () => {
    let issued = 0
    const { client, requests } = clientOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: () => ({ json: tokenReply({ access_token: `ya29.token-number-${++issued}-0000000000` }) }),
      },
      {
        method: "GET",
        url: USERINFO_URL,
        reply: (request) =>
          request.headers.authorization === "Bearer ya29.token-number-2-0000000000"
            ? REPLY
            : { status: 401, json: { error: { message: "expired", status: "UNAUTHENTICATED" } } },
      },
    ])
    expect(await client.request(GET_ROUTE)).toEqual(REPLY.json)
    expect(requests.map((request) => request.url.host)).toEqual([
      "oauth2.googleapis.com",
      "openidconnect.googleapis.com",
      "oauth2.googleapis.com",
      "openidconnect.googleapis.com",
    ])
  })

  test("a second 401 fails as unauthenticated, with no third try", async () => {
    const { client, requests } = clientOver([
      tokenHandler,
      { method: "GET", url: USERINFO_URL, reply: { status: 401, json: { error: { message: "no" } } } },
    ])
    const error = await toolError(client.request(GET_ROUTE))
    expect(error.code).toBe("unauthenticated")
    expect(callsTo(requests, "openidconnect.googleapis.com")).toHaveLength(2)
  })

  test("other failures are not retried", async () => {
    const { client, requests } = clientOver([
      tokenHandler,
      { method: "GET", url: USERINFO_URL, reply: { status: 403, json: { error: { status: "PERMISSION_DENIED" } } } },
    ])
    expect((await toolError(client.request(GET_ROUTE))).code).toBe("forbidden")
    expect(callsTo(requests, "openidconnect.googleapis.com")).toHaveLength(1)
  })
})
