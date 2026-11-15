import type { FetchLike } from "./fetch"
import type { Method } from "./routes"

/** A made-up access token, shaped like Google's. */
export const FAKE_ACCESS_TOKEN = "ya29.fake-access-token-0000000000000001"

/** The statuses a `Response` cannot carry a body with. */
const BODYLESS_STATUSES: readonly number[] = [204, 205, 304]

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"

/** One request the fake received. */
export type FakeRequest = {
  method: Method
  url: URL
  /** Header names are lower-case. */
  headers: Record<string, string>
  body: string | undefined
  /** The body, when it is form-encoded. */
  form?: Record<string, string>
  /** The body, when it is JSON. */
  json?: unknown
  signal?: AbortSignal
}

/** What the fake answers: a JSON body, or a text one, with a status (default 200) and headers. */
export type FakeReply = {
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

export type FakeHandler = {
  method: Method
  /** A string matches the origin and path exactly, the query ignored; a RegExp is tested against the whole URL. */
  url: string | RegExp
  reply: FakeReply | ((request: FakeRequest) => FakeReply | Promise<FakeReply>)
  /** Answer one request only; later ones fall through to the next handler that matches. */
  once?: boolean
}

function matches(handler: FakeHandler, request: FakeRequest): boolean {
  if (handler.method !== request.method) return false
  if (typeof handler.url === "string") return handler.url === `${request.url.origin}${request.url.pathname}`
  return handler.url.test(request.url.toString())
}

function describeRequest(url: string, init: RequestInit): FakeRequest {
  const parsed = new URL(url)
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const body = typeof init.body === "string" ? init.body : undefined
  const contentType = headers["content-type"] ?? ""
  const request: FakeRequest = {
    method: (init.method ?? "GET").toUpperCase() as Method,
    url: parsed,
    headers,
    body,
    signal: init.signal ?? undefined,
  }
  if (body !== undefined && contentType.startsWith(FORM_CONTENT_TYPE)) {
    request.form = Object.fromEntries(new URLSearchParams(body))
  }
  if (body !== undefined && contentType.includes("json")) request.json = JSON.parse(body)
  return request
}

function toResponse(reply: FakeReply): Response {
  const status = reply.status ?? 200
  const headers = new Headers(reply.headers)
  let body: string | null = reply.text ?? ""
  if (reply.json !== undefined) {
    body = JSON.stringify(reply.json)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
  }
  return new Response(BODYLESS_STATUSES.includes(status) ? null : body, { status, headers })
}

/** Rejects with the signal's reason when it aborts, as a real `fetch` does. */
function whenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

/**
 * A fake Google: a `fetch` that answers from `handlers` and records every
 * request it gets, so no test reaches the network. The first handler that
 * matches the method and URL answers; a request no handler matches throws an
 * error naming its method and URL, so a test fails loudly. A handler that
 * waits forever is cut off by the request's signal, like a real call.
 */
export function fakeGoogle(handlers: readonly FakeHandler[]): { fetch: FetchLike; requests: FakeRequest[] } {
  const requests: FakeRequest[] = []
  const spent = new Set<FakeHandler>()

  const fetch: FetchLike = async (url, init) => {
    const request = describeRequest(url, init)
    requests.push(request)
    const handler = handlers.find((candidate) => !spent.has(candidate) && matches(candidate, request))
    if (!handler) throw new Error(`fakeGoogle: no handler for ${request.method} ${request.url.toString()}`)
    if (handler.once) spent.add(handler)
    const reply = typeof handler.reply === "function" ? handler.reply(request) : handler.reply
    return toResponse(await Promise.race([reply, whenAborted(request.signal)]))
  }

  return { fetch, requests }
}

/** A valid token endpoint reply, with `overrides` laid over it. */
export function tokenReply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: FAKE_ACCESS_TOKEN,
    expires_in: 3599,
    scope: "openid https://www.googleapis.com/auth/userinfo.email",
    token_type: "Bearer",
    ...overrides,
  }
}
