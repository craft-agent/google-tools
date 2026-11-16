import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { GoogleClient } from "./client"
import { CREDENTIAL, TOKEN_URL, USERINFO_URL, VARIABLE, makeLabel, storeCredential, toolError } from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { OAUTH_ROUTES, type Route } from "./routes"
import { clearTokenCache } from "./token"

const ROUTE: Route = { ...OAUTH_ROUTES.userinfo, method: "POST" }

const CONTENT = {
  type: "multipart/related; boundary=abc",
  bytes: new TextEncoder().encode("--abc\r\nhello\r\n--abc--"),
}

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

function clientOver(handlers: FakeHandler[]) {
  const google = fakeGoogle([tokenHandler, ...handlers])
  const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch })
  return {
    client,
    /** What the fake received at the route, the token refresh left out. */
    requests: () => google.requests.filter((request) => request.url.href.startsWith(USERINFO_URL)),
  }
}

describe("GoogleClient.request content", () => {
  test("sends the bytes as they are with their own Content-Type, beside the bearer token and Accept", async () => {
    const { client, requests } = clientOver([{ method: "POST", url: USERINFO_URL, reply: { json: { id: "x" } } }])
    expect(await client.request(ROUTE, { content: CONTENT })).toEqual({ id: "x" })
    const [call] = requests()
    expect(call?.headers["content-type"]).toBe(CONTENT.type)
    expect(call?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
    expect(call?.headers.accept).toBe("application/json")
    expect(call?.bytes).toEqual(CONTENT.bytes)
    expect(call?.body).toBeUndefined()
    expect(call?.json).toBeUndefined()
  })

  test("a JSON body and content together are internal_error, and nothing is sent", async () => {
    const { client, requests } = clientOver([])
    const error = await toolError(client.request(ROUTE, { body: {}, content: CONTENT }))
    expect(error.code).toBe("internal_error")
    expect(requests()).toEqual([])
  })

  test("after a 401 it sends the same bytes again with a fresh token", async () => {
    const { client, requests } = clientOver([
      { method: "POST", url: USERINFO_URL, reply: { status: 401, json: {} }, once: true },
      { method: "POST", url: USERINFO_URL, reply: { json: {} } },
    ])
    await client.request(ROUTE, { content: CONTENT })
    expect(requests().map((request) => request.bytes)).toEqual([CONTENT.bytes, CONTENT.bytes])
  })

  test("a failure shows Google's message masked and never the content", async () => {
    const message = `rejected ${FAKE_ACCESS_TOKEN}`
    const { client } = clientOver([
      {
        method: "POST",
        url: USERINFO_URL,
        reply: { status: 400, json: { error: { message, status: "INVALID_ARGUMENT" } } },
      },
    ])
    const error = await toolError(client.request(ROUTE, { content: CONTENT }))
    expect(error.message).toContain(MASK)
    expect(error.message).not.toContain(FAKE_ACCESS_TOKEN)
    expect(error.message).not.toContain("hello")
  })
})

describe("GoogleClient.accountEmail", () => {
  test("is the address the credential records, without calling Google", async () => {
    const { client, requests } = clientOver([])
    expect(await client.accountEmail()).toBe(CREDENTIAL.email)
    expect(requests()).toEqual([])
  })

  test("is null when the credential records none", async () => {
    await storeCredential(paths, { ...CREDENTIAL, email: null })
    const { client } = clientOver([])
    expect(await client.accountEmail()).toBeNull()
  })
})
