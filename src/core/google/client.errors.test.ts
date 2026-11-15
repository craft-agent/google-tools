import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import type { ErrorCode } from "../errors"
import { GoogleClient } from "./client"
import {
  CLIENT_SECRET,
  REFRESH_TOKEN,
  TOKEN_URL,
  USERINFO_URL,
  VARIABLE,
  makeLabel,
  storeCredential,
  toolError,
} from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { OAUTH_ROUTES } from "./routes"
import { clearTokenCache } from "./token"

const PLAIN_ACCESS_TOKEN = "plainAccessToken-HHHH0123456789"

const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }

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

function clientOver(handlers: FakeHandler[], options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const google = fakeGoogle(handlers)
  const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch, ...options })
  return { client, requests: google.requests }
}

function infoReply(reply: FakeHandler["reply"]): FakeHandler {
  return { method: "GET", url: USERINFO_URL, reply }
}

describe("GoogleClient failures", () => {
  test.each([
    [404, { error: { message: "File not found", status: "NOT_FOUND" } }, "not_found"],
    [403, { error: { message: "no", errors: [{ reason: "insufficientPermissions" }] } }, "forbidden"],
    [412, { error: { message: "etag differs" } }, "stale"],
    [429, { error: { message: "slow down", status: "RESOURCE_EXHAUSTED" } }, "rate_limited"],
    [403, { error: { message: "slow down", errors: [{ reason: "userRateLimitExceeded" }] } }, "rate_limited"],
    [500, { error: { message: "internal" } }, "upstream_error"],
  ])("a %i answer is %s", async (status, json, code) => {
    const { client } = clientOver([tokenHandler, infoReply({ status, json })])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(error.code).toBe(code as ErrorCode)
    expect(error.message.startsWith("Google: ")).toBe(true)
    expect(error.details).toMatchObject({ status })
  })

  test("a non-JSON failure body says only its status", async () => {
    const { client } = clientOver([tokenHandler, infoReply({ status: 502, text: "<html>Bad gateway</html>" })])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google: HTTP 502")
  })

  test("a success body that is not JSON is upstream_error", async () => {
    const { client } = clientOver([tokenHandler, infoReply({ text: "plain" })])
    expect((await toolError(client.request(OAUTH_ROUTES.userinfo))).code).toBe("upstream_error")
  })

  test("a redirect is not followed", async () => {
    const { client, requests } = clientOver([
      tokenHandler,
      infoReply({ status: 307, headers: { location: "https://elsewhere.test/" } }),
    ])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
    expect(requests.filter((request) => request.url.host === "elsewhere.test")).toHaveLength(0)
    expect(requests).toHaveLength(2)
  })

  test("a request is sent with redirect handling set to manual", async () => {
    const seen: (RequestRedirect | undefined)[] = []
    const google = fakeGoogle([tokenHandler, infoReply({ json: {} })])
    const client = new GoogleClient({
      paths,
      variable: VARIABLE,
      env: {},
      fetch: (url, init) => {
        seen.push(init.redirect)
        return google.fetch(url, init)
      },
    })
    await client.request(OAUTH_ROUTES.userinfo)
    expect(seen).toEqual(["manual", "manual"])
  })
})

describe("GoogleClient time limit and cancellation", () => {
  test("a call that outlasts the time limit is upstream_error", async () => {
    const { client } = clientOver([tokenHandler, infoReply(() => new Promise(() => {}))], { timeoutMs: 30 })
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google did not answer within 0.03 s")
  })

  test("the caller's signal cancels the call", async () => {
    const controller = new AbortController()
    const { client } = clientOver([tokenHandler, infoReply(() => new Promise(() => {}))], { signal: controller.signal })
    const pending = toolError(client.request(OAUTH_ROUTES.userinfo))
    setTimeout(() => controller.abort(), 30)
    const error = await pending
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call was cancelled.")
  })

  test("a signal cancelled beforehand sends nothing", async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, requests } = clientOver([tokenHandler, infoReply({ json: {} })], { signal: controller.signal })
    expect((await toolError(client.request(OAUTH_ROUTES.userinfo))).message).toBe("The call was cancelled.")
    expect(requests).toHaveLength(0)
  })

  test("a network failure is upstream_error with the cause's message, masked", async () => {
    const { client } = clientOver([
      tokenHandler,
      infoReply(() => {
        throw new Error(`socket hang up for ${FAKE_ACCESS_TOKEN} and ${REFRESH_TOKEN}`)
      }),
    ])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Google could not be reached: socket hang up for ${MASK} and ${MASK}`)
    expect(error.cause).toBeUndefined()
  })
})

describe("GoogleClient masking", () => {
  test("masks the access token, the refresh token and the client secret in a reply", async () => {
    const { client } = clientOver([
      { method: "POST", url: TOKEN_URL, reply: { json: tokenReply({ access_token: PLAIN_ACCESS_TOKEN }) } },
      infoReply({
        json: {
          note: `echo ${PLAIN_ACCESS_TOKEN} ${REFRESH_TOKEN}`,
          nested: [{ secret: CLIENT_SECRET, shaped: FAKE_ACCESS_TOKEN }],
          [PLAIN_ACCESS_TOKEN]: 1,
          count: 3,
        },
      }),
    ])
    expect(await client.request(OAUTH_ROUTES.userinfo)).toEqual({
      note: `echo ${MASK} ${MASK}`,
      nested: [{ secret: MASK, shaped: MASK }],
      [MASK]: 1,
      count: 3,
    })
  })

  test("masks the same values in an error message and its details", async () => {
    const { client } = clientOver([
      { method: "POST", url: TOKEN_URL, reply: { json: tokenReply({ access_token: PLAIN_ACCESS_TOKEN }) } },
      infoReply({
        status: 400,
        json: {
          error: {
            message: `bad ${PLAIN_ACCESS_TOKEN} ${REFRESH_TOKEN}`,
            status: "INVALID_ARGUMENT",
            errors: [{ reason: CLIENT_SECRET }],
          },
        },
      }),
    ])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    const text = JSON.stringify({ message: error.message, details: error.details })
    for (const secret of [PLAIN_ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET]) expect(text).not.toContain(secret)
    expect(error.message).toBe(`Google: bad ${MASK} ${MASK}`)
  })

  test("the token endpoint's failure does not leak the credential through the client", async () => {
    const { client } = clientOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: { status: 401, json: { error: "invalid_client", error_description: `${CLIENT_SECRET}` } },
      },
    ])
    const error = await toolError(client.request(OAUTH_ROUTES.userinfo))
    expect(JSON.stringify(error.message)).not.toContain(CLIENT_SECRET)
  })
})
