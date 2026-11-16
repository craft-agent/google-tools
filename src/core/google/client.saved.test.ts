import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { GoogleClient } from "./client"
import {
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

const ROUTE = OAUTH_ROUTES.userinfo

/** A run shaped like an API key, which shape masking replaces. Built from parts so no line reads as a secret. */
const API_KEY_SHAPE = ["AIza", "B".repeat(35)].join("")

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

function clientOver(handlers: FakeHandler[], timeoutMs?: number) {
  const google = fakeGoogle([tokenHandler, ...handlers])
  return new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch, timeoutMs })
}

describe("GoogleClient.request saved", () => {
  const reply = {
    data: `AA${API_KEY_SHAPE}AA`,
    other: `AA${API_KEY_SHAPE}AA`,
    nested: { data: `AA${API_KEY_SHAPE}AA` },
  }

  test("a saved key keeps what only looks like a credential, and every other key is still masked", async () => {
    const client = clientOver([{ method: "GET", url: USERINFO_URL, reply: { json: reply } }])

    expect(await client.request(ROUTE, { saved: ["data"] })).toEqual({
      data: reply.data,
      other: `AA${MASK}AA`,
      nested: { data: `AA${MASK}AA` },
    })
  })

  test("without `saved` every key is masked as before", async () => {
    const client = clientOver([{ method: "GET", url: USERINFO_URL, reply: { json: reply } }])

    expect(await client.request(ROUTE)).toEqual({
      data: `AA${MASK}AA`,
      other: `AA${MASK}AA`,
      nested: { data: `AA${MASK}AA` },
    })
  })

  test("a saved key is still masked for the label's own secrets: the refresh token and the access token", async () => {
    const client = clientOver([
      { method: "GET", url: USERINFO_URL, reply: { json: { data: `x${REFRESH_TOKEN}y${FAKE_ACCESS_TOKEN}z` } } },
    ])

    expect(await client.request(ROUTE, { saved: ["data"] })).toEqual({ data: `x${MASK}y${MASK}z` })
  })
})

describe("GoogleClient.request timeoutMs", () => {
  const never: FakeHandler = { method: "GET", url: USERINFO_URL, reply: () => new Promise(() => {}) }

  test("stops a call that outlasts its own limit, which names that limit", async () => {
    const client = clientOver([never])

    const error = await toolError(client.request(ROUTE, { timeoutMs: 50 }))

    expect(error).toMatchObject({ code: "upstream_error", message: "Google did not answer within 0.05 s" })
  })

  test("a call's limit replaces the client's, longer or shorter", async () => {
    const slow: FakeHandler = {
      method: "GET",
      url: USERINFO_URL,
      reply: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150))
        return { json: { ok: true } }
      },
    }

    expect(await clientOver([slow], 20).request(ROUTE, { timeoutMs: 1000 })).toEqual({ ok: true })
    expect((await toolError(clientOver([slow], 1000).request(ROUTE, { timeoutMs: 20 }))).code).toBe("upstream_error")
  })
})
