import { describe, expect, test } from "bun:test"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply } from "./fake-google.testing"
import { parseTokenReply } from "./token"

const URL_A = "https://oauth2.googleapis.com/token"

describe("fakeGoogle", () => {
  test("matches a string URL on origin and path, ignoring the query, and records the request", async () => {
    const { fetch, requests } = fakeGoogle([{ method: "GET", url: URL_A, reply: { json: { ok: 1 } } }])
    const response = await fetch(`${URL_A}?x=1`, { method: "GET", headers: { Authorization: "Bearer t" } })
    expect(await response.json()).toEqual({ ok: 1 })
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe("Bearer t")
    expect(requests[0]?.url.searchParams.get("x")).toBe("1")
  })

  test("matches a RegExp against the whole URL and parses form and JSON bodies", async () => {
    const { fetch, requests } = fakeGoogle([
      { method: "POST", url: /token\?x=1$/, reply: { status: 201, text: "made" } },
    ])
    const form = await fetch(`${URL_A}?x=1`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "a=1&b=two",
    })
    expect(form.status).toBe(201)
    expect(await form.text()).toBe("made")
    expect(requests[0]?.form).toEqual({ a: "1", b: "two" })
    await fetch(`${URL_A}?x=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"k":[1]}' })
    expect(requests[1]?.json).toEqual({ k: [1] })
  })

  test("an unmatched request throws naming the method and URL", async () => {
    const { fetch } = fakeGoogle([{ method: "GET", url: URL_A, reply: {} }])
    await expect(fetch(URL_A, { method: "POST" })).rejects.toThrow(`no handler for POST ${URL_A}`)
    await expect(fetch("https://other.example.test/x", {})).rejects.toThrow(
      "no handler for GET https://other.example.test/x",
    )
  })

  test("once answers a single request, then the next matching handler answers", async () => {
    const { fetch } = fakeGoogle([
      { method: "GET", url: URL_A, once: true, reply: { text: "first" } },
      { method: "GET", url: URL_A, reply: { text: "later" } },
    ])
    expect(await (await fetch(URL_A, {})).text()).toBe("first")
    expect(await (await fetch(URL_A, {})).text()).toBe("later")
    expect(await (await fetch(URL_A, {})).text()).toBe("later")
  })

  test("a handler function gets the request and may be async", async () => {
    const { fetch } = fakeGoogle([
      { method: "POST", url: URL_A, reply: async (request) => ({ json: { seen: request.body } }) },
    ])
    expect(await (await fetch(URL_A, { method: "POST", body: "hello" })).json()).toEqual({ seen: "hello" })
  })

  test("a handler that never answers is cut off by the signal", async () => {
    const { fetch } = fakeGoogle([{ method: "GET", url: URL_A, reply: () => new Promise(() => {}) }])
    const controller = new AbortController()
    const pending = fetch(URL_A, { signal: controller.signal })
    controller.abort(new Error("stop"))
    await expect(pending).rejects.toThrow("stop")
  })

  test("a 204 has no body and a 302 keeps its headers", async () => {
    const { fetch } = fakeGoogle([
      { method: "GET", url: URL_A, reply: { status: 204 } },
      { method: "POST", url: URL_A, reply: { status: 302, headers: { location: "https://x.test/" } } },
    ])
    expect((await fetch(URL_A, {})).status).toBe(204)
    expect((await fetch(URL_A, { method: "POST" })).headers.get("location")).toBe("https://x.test/")
  })
})

describe("tokenReply", () => {
  test("is a valid token reply with a made-up access token, overridable", () => {
    expect(parseTokenReply(tokenReply(), []).access_token).toBe(FAKE_ACCESS_TOKEN)
    expect(tokenReply({ expires_in: 5 }).expires_in).toBe(5)
  })
})
