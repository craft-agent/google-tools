import { stat } from "node:fs/promises"
import { ToolError, isToolError } from "../errors"
import { readCredential, writeCredential, type Credential, type CredentialSource } from "./credentials"
import { DEFAULT_TIMEOUT_MS, MS_PER_SECOND, readReply, sendRequest, type FetchLike } from "./fetch"
import { INVALID_GRANT } from "./google-errors"
import type { LabelPaths } from "./labels"
import { isMissingPath } from "./missing-path"
import { withRefreshLock } from "./refresh-lock"
import { OAUTH_ROUTES, routeUrl } from "./routes"

/** An access token is refreshed this long before it expires, so a call never starts with a token about to lapse. */
const EXPIRY_MARGIN_MS = 60_000

/** The fields of an OAuth form that hold a secret, which no error shows. */
const FORM_SECRET_FIELDS = ["refresh_token", "client_secret", "code", "code_verifier", "token"] as const

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"

/** What a token reply carries, checked. */
export type TokenReply = {
  access_token: string
  /** Seconds the access token lives. */
  expires_in: number
  scope: string[]
  refresh_token?: string
  id_token?: string
}

/** A label's credential and where it was read from. */
export type SourcedCredential = {
  source: CredentialSource
  credential: Credential
}

/** An access token with the credential it came from. */
export type AccessGrant = SourcedCredential & { token: string }

export type TokenSourceOptions = {
  paths: LabelPaths
  /** The name of the variable that may hold the label's credential. */
  variable: string
  env: Readonly<Record<string, string | undefined>>
  fetch: FetchLike
  /** The clock, in milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number
}

type CacheEntry = { token: string; expiresAt: number }

/** The access tokens of this process, by label directory and the refresh token they came from. */
const tokenCache = new Map<string, CacheEntry>()

function cacheKey(paths: LabelPaths, refreshToken: string): string {
  return `${paths.dir}\0${refreshToken}`
}

/** Drops the cached access token that `refreshToken` of the label earned. */
export function forgetAccessToken(paths: LabelPaths, refreshToken: string): void {
  tokenCache.delete(cacheKey(paths, refreshToken))
}

/** Drops every cached access token; for tests. */
export function clearTokenCache(): void {
  tokenCache.clear()
}

/**
 * Calls an OAuth endpoint (`token` or `revoke`) with a form-encoded POST and
 * returns the parsed reply (an empty body is `{}`). No redirect is followed.
 * A failure throws what `googleError` maps it to, with the form's secret
 * values masked from every message and detail.
 *
 * A success reply is returned as it is, since it is where the access token
 * comes from; it is never shown, only parsed (`parseTokenReply`).
 */
export async function postOAuth(
  fetch: FetchLike,
  routeName: "token" | "revoke",
  form: Record<string, string>,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  const route = OAUTH_ROUTES[routeName]
  const known = FORM_SECRET_FIELDS.flatMap((field) => form[field] ?? [])
  const init: RequestInit = {
    method: route.method,
    headers: { "Content-Type": FORM_CONTENT_TYPE, Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  }
  const reply = await sendRequest({ fetch, ...options }, routeUrl(route).toString(), init, known)
  return readReply(reply, known)
}

function unexpectedReply(): ToolError {
  return new ToolError("upstream_error", "Google answered the token request with an unexpected reply.")
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== ""
}

function scopesOf(scope: unknown, fallback: readonly string[]): string[] {
  if (scope === undefined) return [...fallback]
  if (typeof scope !== "string") throw unexpectedReply()
  return scope.split(/\s+/).filter((item) => item !== "")
}

/**
 * Checks a token reply: `access_token` a non-empty string, `expires_in` a
 * positive number, `scope` a space-separated string (absent: `fallbackScopes`)
 * and `refresh_token` and `id_token`, when present, non-empty strings.
 * Anything else throws `upstream_error` without echoing the reply.
 */
export function parseTokenReply(body: unknown, fallbackScopes: readonly string[]): TokenReply {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw unexpectedReply()
  const record = body as Record<string, unknown>
  const { access_token, expires_in, refresh_token, id_token } = record
  if (!isNonEmptyString(access_token)) throw unexpectedReply()
  if (typeof expires_in !== "number" || !Number.isFinite(expires_in) || expires_in <= 0) throw unexpectedReply()
  const reply: TokenReply = { access_token, expires_in, scope: scopesOf(record.scope, fallbackScopes) }
  for (const [name, value] of [
    ["refresh_token", refresh_token],
    ["id_token", id_token],
  ] as const) {
    if (value === undefined) continue
    if (!isNonEmptyString(value)) throw unexpectedReply()
    reply[name] = value
  }
  return reply
}

function refusedCredential(label: string): ToolError {
  return new ToolError(
    "unauthenticated",
    `Google refused the credential of account "${label}"; it was revoked or expired. Log the account in again.`,
    { details: { account: label, reason: INVALID_GRANT } },
  )
}

/**
 * The access tokens of one label: read from the label's credential, kept in
 * memory per process and refreshed under the label's refresh lock.
 */
export class TokenSource {
  readonly #paths: LabelPaths
  readonly #variable: string
  readonly #env: Readonly<Record<string, string | undefined>>
  readonly #fetch: FetchLike
  readonly #now: () => number
  readonly #timeoutMs: number

  constructor(options: TokenSourceOptions) {
    this.#paths = options.paths
    this.#variable = options.variable
    this.#env = options.env
    this.#fetch = options.fetch
    this.#now = options.now ?? Date.now
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** The label's credential as it is now; a new login is seen on the next call. */
  readCredential(): Promise<SourcedCredential> {
    return readCredential({ paths: this.#paths, variable: this.#variable, env: this.#env })
  }

  /**
   * An access token for the label, from this process's cache while it has
   * more than a minute left, else from a refresh.
   *
   * A refresh runs under the label's refresh lock when the label has a
   * directory (a label given by variable only may have none, and then
   * refreshes without it). The credential is read again under the lock and the
   * cache checked again, since another process may have refreshed or logged in
   * meanwhile. A refresh token Google rotates is written back to the credential
   * file only when the file still holds the one it replaces; a credential from
   * the variable is never written.
   *
   * `invalid_grant` throws `unauthenticated` with `details.account` and
   * `details.reason`, and drops the cached token.
   */
  async accessToken(signal?: AbortSignal): Promise<AccessGrant> {
    const current = await this.readCredential()
    const cached = this.#cached(current)
    if (cached) return cached
    if (!(await this.#hasDirectory())) return this.#refresh(current, signal)
    return withRefreshLock(
      this.#paths.lock,
      async () => {
        const latest = await this.readCredential()
        return this.#cached(latest) ?? (await this.#refresh(latest, signal))
      },
      { signal },
    )
  }

  #cached({ credential, source }: SourcedCredential): AccessGrant | undefined {
    const entry = tokenCache.get(cacheKey(this.#paths, credential.refresh_token))
    if (!entry || this.#now() >= entry.expiresAt - EXPIRY_MARGIN_MS) return undefined
    return { token: entry.token, credential, source }
  }

  async #hasDirectory(): Promise<boolean> {
    try {
      return (await stat(this.#paths.dir)).isDirectory()
    } catch (error) {
      if (isMissingPath(error)) return false
      throw error
    }
  }

  async #refresh({ credential, source }: SourcedCredential, signal?: AbortSignal): Promise<AccessGrant> {
    const reply = await this.#requestToken(credential, signal)
    let current = credential
    const rotated = reply.refresh_token
    if (
      rotated !== undefined &&
      rotated !== credential.refresh_token &&
      source === "file" &&
      (await this.#writeRotation(credential, rotated))
    ) {
      current = { ...credential, refresh_token: rotated }
    }
    tokenCache.set(cacheKey(this.#paths, current.refresh_token), {
      token: reply.access_token,
      expiresAt: this.#now() + reply.expires_in * MS_PER_SECOND,
    })
    return { token: reply.access_token, credential: current, source }
  }

  async #requestToken(credential: Credential, signal?: AbortSignal): Promise<TokenReply> {
    const form = {
      grant_type: "refresh_token",
      refresh_token: credential.refresh_token,
      client_id: credential.client_id,
      client_secret: credential.client_secret,
    }
    try {
      const body = await postOAuth(this.#fetch, "token", form, { timeoutMs: this.#timeoutMs, signal })
      return parseTokenReply(body, credential.scopes)
    } catch (error) {
      if (isToolError(error) && error.code === "unauthenticated" && error.details?.reason === INVALID_GRANT) {
        forgetAccessToken(this.#paths, credential.refresh_token)
        throw refusedCredential(this.#paths.label)
      }
      throw error
    }
  }

  /** Writes `refreshToken` over `replaced` in the credential file, unless the file no longer holds `replaced`; whether it did. */
  async #writeRotation(replaced: Credential, refreshToken: string): Promise<boolean> {
    let latest: Credential
    try {
      // An empty environment makes the read come from the file.
      latest = (await readCredential({ paths: this.#paths, variable: this.#variable, env: {} })).credential
    } catch (error) {
      if (isToolError(error)) return false
      throw error
    }
    if (latest.refresh_token !== replaced.refresh_token) return false
    await writeCredential(this.#paths, { ...latest, refresh_token: refreshToken })
    return true
  }
}
