import { ToolError } from "../errors"
import { credentialSecrets, type Credential } from "./credentials"
import {
  DEFAULT_TIMEOUT_MS,
  failedReplyError,
  isSuccess,
  readReply,
  sendRequest,
  type FetchLike,
  type HttpReply,
  type Transport,
} from "./fetch"
import type { LabelPaths } from "./labels"
import { maskValue } from "./mask"
import {
  HTTP_RESUME_INCOMPLETE,
  contentRange,
  nextOffset,
  sessionSecrets,
  sessionUri,
  type ChunkReply,
  type ResumableSession,
} from "./resumable"
import { routeUrl, type QueryValue, type Route } from "./routes"
import { UNAUTHORIZED, sendDownload, type DownloadSink, type Downloaded } from "./stream"
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
  /** Sent as it is with its own `Content-Type`, such as a multipart body; never together with `body`. */
  content?: { type: string; bytes: Uint8Array }
  /** Sent beside `Authorization` and `Accept`, which these never replace. */
  headers?: Record<string, string>
  /** The time limit of this call, body included; defaults to the client's. */
  timeoutMs?: number
  /**
   * Top-level keys of the JSON reply whose string values the tool writes to a
   * file and never returns, such as an attachment's `data`. They are masked for
   * the label's own secrets only (the credential's and the access token, exact
   * values), not for credential shapes, which would corrupt file content such
   * as base64. Every other key is masked as usual.
   */
  saved?: readonly string[]
}

export type ResumableOptions = {
  /** Values for the `{name}` parts of the start route's path. */
  params?: Record<string, string>
  query?: Record<string, QueryValue>
  /** What names the file, sent as JSON to start the session. */
  metadata: unknown
  /** The media type of the content, which every chunk carries. */
  contentType: string
  /** The content's size in bytes. */
  size: number
  /** The time limit of the start and of each chunk, body included; defaults to the client's. */
  timeoutMs?: number
}

export type DownloadOptions = {
  /** Values for the `{name}` parts of the route's path. */
  params?: Record<string, string>
  query?: Record<string, QueryValue>
  /** The time limit of this download, body included; defaults to the client's. */
  timeoutMs?: number
} & DownloadSink

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
   * Throws `unauthenticated`, as `request` would, when the label lacks the
   * scopes of the route; nothing is sent. A tool that reads before it writes
   * asks this first, so a label that cannot write fails before any call.
   */
  async requireScopes(route: Route): Promise<void> {
    const { credential } = await this.#tokens.readCredential()
    checkScopes(route, this.#paths.label, credential, this.#missingScopeFix)
  }

  /** The address the label's credential records, `null` when it records none; the credential itself never leaves the client. */
  async accountEmail(): Promise<string | null> {
    return (await this.#tokens.readCredential()).credential.email
  }

  /**
   * Calls one allowlisted route and returns its parsed JSON reply (an empty
   * one is `{}`), every string masked.
   *
   * The URL is built from the route (a host or path off the allowlist, or a
   * bad param, fails first), then the label's scopes are checked against the
   * route's before any network call. A JSON `body` or raw `content` is sent
   * as given and never logged or echoed in an error. A 401 forgets the cached access token and
   * retries once with a fresh one. A redirect is never followed; a failure
   * status throws what `googleError` maps it to.
   */
  async request<T = unknown>(route: Route, options: RequestOptions = {}): Promise<T> {
    if (options.body !== undefined && options.content !== undefined) {
      throw new ToolError("internal_error", "A request carries a JSON body or raw content, never both.")
    }
    const url = routeUrl(route, options.params, options.query).toString()
    const { reply, known } = await this.#exchange(route, url, options)
    return maskValue(readReply(reply, known), known, options.saved) as T
  }

  /**
   * Opens a resumable upload: sends `options.metadata` as JSON to `start`,
   * which names the file, and returns the session Google answers with. Its
   * address, from the `Location` header, must be the one `chunk` names with an
   * `upload_id` (see `sessionUri`), else the call fails as `upstream_error` and
   * nothing more is sent. The address is a bearer capability while the session
   * lives: it is never returned, shown or logged, and is masked from every
   * later text of the session like a credential. The session's chunks go
   * through `ResumableSession.put`, each with `options.timeoutMs`; a failure is
   * mapped as in `request`, and nothing is retried here.
   */
  async startResumable(start: Route, chunk: Route, options: ResumableOptions): Promise<ResumableSession> {
    const url = routeUrl(start, options.params, options.query).toString()
    const { reply, known } = await this.#exchange(start, url, {
      body: options.metadata,
      headers: { "X-Upload-Content-Type": options.contentType, "X-Upload-Content-Length": String(options.size) },
      timeoutMs: options.timeoutMs,
    })
    if (!isSuccess(reply.status)) throw failedReplyError(reply, known)
    const location = reply.headers.get("location")
    const uri = sessionUri(location, chunk)
    const secrets = sessionSecrets(location!, uri)

    return {
      put: async <T>(bytes: Uint8Array, offset: number, total: number): Promise<ChunkReply<T>> => {
        const range = contentRange(offset, bytes.length, total)
        const { reply, known } = await this.#exchange(
          chunk,
          uri.href,
          {
            content: { type: options.contentType, bytes },
            headers: { "Content-Range": range, "Content-Length": String(bytes.length) },
            timeoutMs: options.timeoutMs,
          },
          { secrets, through: [HTTP_RESUME_INCOMPLETE] },
        )
        if (reply.status === HTTP_RESUME_INCOMPLETE) {
          return { done: false, offset: nextOffset(reply.headers.get("range"), offset, bytes.length) }
        }
        return { done: true, file: maskValue(readReply(reply, known), known) as T }
      },
    }
  }

  /**
   * Calls one allowlisted route and streams its body to `options.write`,
   * returning how many bytes came and their media type. Scopes, token, time
   * limit (which covers the whole body), the retry after a 401 and the refusal
   * of a redirect are as in `request`; a failure status throws what
   * `googleError` maps it to. A body whose content type does not start with
   * `options.accept` is `upstream_error` naming the type only, and one over
   * `options.maxBytes` stops as `invalid_argument`. A call that fails may have
   * written part of the body: the caller removes it.
   */
  async download(route: Route, options: DownloadOptions): Promise<Downloaded> {
    const url = routeUrl(route, options.params, options.query).toString()
    const { credential } = await this.#tokens.readCredential()
    checkScopes(route, this.#paths.label, credential, this.#missingScopeFix)
    const transport = { ...this.#transport, timeoutMs: options.timeoutMs ?? this.#transport.timeoutMs }

    for (let attempt = 0; ; attempt++) {
      const grant = await this.#tokens.accessToken(this.#transport.signal)
      const known = [...credentialSecrets(grant.credential), grant.token]
      const init = this.#init(route, {}, grant.token, options.accept)
      const outcome = await sendDownload(transport, url, init, known, options, attempt === 0)
      if (outcome === UNAUTHORIZED) {
        forgetAccessToken(this.#paths, grant.credential.refresh_token)
        continue
      }
      return outcome
    }
  }

  /**
   * Sends one request to `url` as `route` and returns the answer with the
   * secrets that mask it: the scopes are checked first, an access token is
   * fetched, a 401 forgets it and retries once with a fresh one, and the time
   * limit is `options.timeoutMs`. `secrets` join the label's own in `known`;
   * `through` are redirect statuses handed back as answers (see `sendRequest`).
   */
  async #exchange(
    route: Route,
    url: string,
    options: RequestOptions,
    { secrets = [], through = [] }: { secrets?: readonly string[]; through?: readonly number[] } = {},
  ): Promise<{ reply: HttpReply; known: string[] }> {
    const { credential } = await this.#tokens.readCredential()
    checkScopes(route, this.#paths.label, credential, this.#missingScopeFix)
    const transport = { ...this.#transport, timeoutMs: options.timeoutMs ?? this.#transport.timeoutMs }

    for (let attempt = 0; ; attempt++) {
      const grant = await this.#tokens.accessToken(this.#transport.signal)
      const known = [...credentialSecrets(grant.credential), grant.token, ...secrets]
      const reply = await sendRequest(transport, url, this.#init(route, options, grant.token), known, through)
      if (reply.status === HTTP_UNAUTHORIZED && attempt === 0) {
        forgetAccessToken(this.#paths, grant.credential.refresh_token)
        continue
      }
      return { reply, known }
    }
  }

  #init(route: Route, options: RequestOptions, token: string, accept = JSON_CONTENT_TYPE): RequestInit {
    const headers = new Headers(options.headers)
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Accept", accept)
    const init: RequestInit = { method: route.method, headers }
    if (options.body !== undefined) {
      headers.set("Content-Type", JSON_CONTENT_TYPE)
      init.body = JSON.stringify(options.body)
    }
    if (options.content !== undefined) {
      headers.set("Content-Type", options.content.type)
      init.body = options.content.bytes as BodyInit
    }
    return init
  }
}
