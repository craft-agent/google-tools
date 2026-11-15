import { ToolError } from "../errors"
import { credentialSecrets, type Credential } from "./credentials"
import { DEFAULT_TIMEOUT_MS, readReply, sendRequest, type FetchLike, type Transport } from "./fetch"
import type { LabelPaths } from "./labels"
import { maskValue } from "./mask"
import { routeUrl, type QueryValue, type Route } from "./routes"
import { TokenSource, forgetAccessToken } from "./token"

export type { FetchLike } from "./fetch"

const HTTP_UNAUTHORIZED = 401

const JSON_CONTENT_TYPE = "application/json"

/** The step for a person that gives the label the scopes of a route it lacks: the route's `needs` and the credential the label holds. */
export type MissingScopeFix = (needs: readonly string[], credential: Credential) => string

export type GoogleClientOptions = {
  paths: LabelPaths
  /** The name of the variable that may hold the label's credential. */
  variable: string
  env: Readonly<Record<string, string | undefined>>
  fetch: FetchLike
  /** The clock, in milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Cancels the call; the call then fails as `upstream_error`, "The call was cancelled.". */
  signal?: AbortSignal
  /** Says what a person runs when the label lacks a route's scopes; the error's message ends with it and its `details` carry it as `fix`. Without it the message only says to log in again. */
  missingScopeFix?: MissingScopeFix
}

export type RequestOptions = {
  /** Values for the `{name}` parts of the route's path. */
  params?: Record<string, string>
  query?: Record<string, QueryValue>
  /** Sent as JSON. */
  body?: unknown
  /** Sent beside `Authorization` and `Accept`, which these never replace. */
  headers?: Record<string, string>
}

/** Throws `unauthenticated` unless one of the route's scopes is among the credential's; a route with no scopes needs none. */
function checkScopes(route: Route, label: string, credential: Credential, missingScopeFix?: MissingScopeFix): void {
  if (route.scopes.length === 0 || route.scopes.some((scope) => credential.scopes.includes(scope))) return
  const needs = [...route.scopes]
  const what = `Google account "${label}" was not logged in with a scope this call needs (${needs.join(" or ")}).`
  if (!missingScopeFix) {
    throw new ToolError("unauthenticated", `${what} Log it in again with the toolsets that need it.`, {
      details: { account: label, needs },
    })
  }
  const fix = missingScopeFix(needs, credential)
  throw new ToolError("unauthenticated", `${what} Ask a person to log it in again with: ${fix}`, {
    details: { account: label, needs, fix },
  })
}

/**
 * The one way a tool reaches Google: allowlisted routes, the label's scopes
 * checked first, no redirect followed, a time limit with cancellation,
 * Google's failures mapped to error codes and every text masked.
 */
export class GoogleClient {
  readonly #paths: LabelPaths
  readonly #tokens: TokenSource
  readonly #transport: Transport
  readonly #missingScopeFix: MissingScopeFix | undefined

  constructor(options: GoogleClientOptions) {
    this.#paths = options.paths
    this.#missingScopeFix = options.missingScopeFix
    this.#tokens = new TokenSource(options)
    this.#transport = {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
    }
  }

  /**
   * Calls one allowlisted route and returns its parsed JSON reply (an empty
   * one is `{}`), every string masked.
   *
   * The URL is built from the route (a host or path off the allowlist, or a
   * bad param, fails first), then the label's scopes are checked against the
   * route's before any network call. A 401 forgets the cached access token and
   * retries once with a fresh one. A redirect is never followed; a failure
   * status throws what `googleError` maps it to.
   */
  async request<T = unknown>(route: Route, options: RequestOptions = {}): Promise<T> {
    const url = routeUrl(route, options.params, options.query).toString()
    const { credential } = await this.#tokens.readCredential()
    checkScopes(route, this.#paths.label, credential, this.#missingScopeFix)

    for (let attempt = 0; ; attempt++) {
      const grant = await this.#tokens.accessToken(this.#transport.signal)
      const known = [...credentialSecrets(grant.credential), grant.token]
      const reply = await sendRequest(this.#transport, url, this.#init(route, options, grant.token), known)
      if (reply.status === HTTP_UNAUTHORIZED && attempt === 0) {
        forgetAccessToken(this.#paths, grant.credential.refresh_token)
        continue
      }
      return maskValue(readReply(reply, known), known) as T
    }
  }

  #init(route: Route, options: RequestOptions, token: string): RequestInit {
    const headers = new Headers(options.headers)
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Accept", JSON_CONTENT_TYPE)
    const init: RequestInit = { method: route.method, headers }
    if (options.body !== undefined) {
      headers.set("Content-Type", JSON_CONTENT_TYPE)
      init.body = JSON.stringify(options.body)
    }
    return init
  }
}
