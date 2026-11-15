import { createHash, randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { ToolError } from "../errors"
import { cancelledError } from "./cancelled"
import { DEFAULT_TIMEOUT_MS, MS_PER_SECOND, type FetchLike } from "./fetch"
import { OAUTH_ROUTES, routeUrl } from "./routes"
import { parseTokenReply, postOAuth } from "./token"

/** What `runConsent` needs: the OAuth client, the scopes to ask for and the person's surroundings. */
export type ConsentOptions = {
  clientId: string
  clientSecret: string
  scopes: string[]
  /** The `fetch` the code is exchanged through. */
  fetch: FetchLike
  /** Opens the consent URL in the person's browser; a failure is only said, never fatal. */
  openBrowser: (url: string) => Promise<void>
  /** Says something to the person, such as the URL to open by hand. */
  notify: (text: string) => void
  signal?: AbortSignal
  /** How long to wait for the browser's answer; defaults to 5 minutes. */
  timeoutMs?: number
  /** The account to preselect on Google's page. */
  loginHint?: string
}

/** What a consent gave: the refresh token, the scopes Google granted and the account's address, when Google gave one. */
export type ConsentResult = {
  refresh_token: string
  scopes: string[]
  email: string | null
}

const DEFAULT_CONSENT_TIMEOUT_MS = 300_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND

/** The address the redirect listens on: the loopback interface only, on a port the system picks. */
const LOOPBACK_HOST = "127.0.0.1"

/** Bytes of randomness in the `state` and in the PKCE verifier (43 characters as base64url). */
const RANDOM_BYTES = 32

/** The error Google puts in the redirect when the person declines. */
const ACCESS_DENIED = "access_denied"

/** What an OAuth error name looks like; anything else is not repeated. */
const ERROR_NAME_PATTERN = /^[a-z_]{1,64}$/

/** How long a close waits for open connections to end before it drops them. */
const CLOSE_GRACE_MS = 1000

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "close",
}
const LOGGED_IN_PAGE = "<!doctype html><title>Logged in</title><p>Logged in; you can close this tab.</p>"
const NOT_LOGGED_IN_PAGE = "<!doctype html><title>Not logged in</title><p>Not logged in; see the terminal.</p>"

/** What Google's redirect carried, once its `state` matched. */
type Callback = { code: string } | { error: string }

/** A request that is no answer from Google, and the status it gets. */
type Ignored = { status: number }

function randomToken(): string {
  return randomBytes(RANDOM_BYTES).toString("base64url")
}

function authorizeUrl(options: ConsentOptions, pkce: { redirectUri: string; state: string; verifier: string }): string {
  const challenge = createHash("sha256").update(pkce.verifier).digest("base64url")
  return routeUrl(
    OAUTH_ROUTES.authorize,
    {},
    {
      client_id: options.clientId,
      redirect_uri: pkce.redirectUri,
      response_type: "code",
      scope: options.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: pkce.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: options.loginHint,
    },
  ).toString()
}

/** Reads a request to the redirect: only a `GET /` that carries the right `state` is Google's answer. */
function readCallback(request: IncomingMessage, state: string): Callback | Ignored {
  if (request.method !== "GET") return { status: 400 }
  let url: URL
  try {
    url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`)
  } catch {
    return { status: 400 }
  }
  if (url.pathname !== "/") return { status: 404 }
  if (url.searchParams.get("state") !== state) return { status: 400 }
  const error = url.searchParams.get("error")
  if (error !== null) return { error }
  const code = url.searchParams.get("code")
  return code ? { code } : { status: 400 }
}

function callbackError(error: string): ToolError {
  if (error === ACCESS_DENIED) return new ToolError("declined", "The consent was declined in the browser.")
  const named = ERROR_NAME_PATTERN.test(error) ? error : "an error that is not shown"
  return new ToolError("upstream_error", `Google refused the consent: ${named}.`)
}

function timeoutError(timeoutMs: number): ToolError {
  const minutes = Math.ceil(timeoutMs / MS_PER_MINUTE)
  return new ToolError(
    "upstream_error",
    `No answer from the browser within ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  )
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new ToolError(
          "internal_error",
          `A local port for the browser to answer on could not be opened (${error.code}).`,
        ),
      )
    })
    server.listen(0, LOOPBACK_HOST, () => resolve((server.address() as AddressInfo).port))
  })
}

/**
 * The code of Google's redirect to `server`. Requests that are not Google's
 * answer are refused and ignored; a decline, another error, the time limit and
 * a cancellation end the wait as errors.
 */
function waitForCode(
  server: Server,
  state: string,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      settle()
    }
    const onAbort = () => finish(() => reject(cancelledError()))
    const timer = setTimeout(() => finish(() => reject(timeoutError(timeoutMs))), timeoutMs)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()

    server.on("request", (request, response) => {
      const callback = readCallback(request, state)
      if ("status" in callback) {
        response.writeHead(callback.status, { Connection: "close" }).end()
        return
      }
      response.writeHead(200, PAGE_HEADERS).end("error" in callback ? NOT_LOGGED_IN_PAGE : LOGGED_IN_PAGE)
      finish(() => ("error" in callback ? reject(callbackError(callback.error)) : resolve(callback.code)))
    })
  })
}

/** Stops listening and waits for the open connections to end; drops them after a grace period. Safe to call twice. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const forced = setTimeout(() => server.closeAllConnections(), CLOSE_GRACE_MS)
    server.close(() => {
      clearTimeout(forced)
      resolve()
    })
    server.closeIdleConnections()
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * The verified address in an ID token's payload, else null. The token is read
 * without checking its signature: it came straight from Google's token
 * endpoint over TLS, which the OpenID Connect guide says needs no validation
 * (https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo).
 */
function emailOf(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1]
  if (!payload) return null
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!isRecord(claims)) return null
  const { email, email_verified } = claims
  if (typeof email !== "string" || email === "") return null
  return email_verified === false || email_verified === "false" ? null : email
}

async function exchangeCode(
  options: ConsentOptions,
  grant: { code: string; verifier: string; redirectUri: string },
): Promise<ConsentResult> {
  const body = await postOAuth(
    options.fetch,
    "token",
    {
      grant_type: "authorization_code",
      code: grant.code,
      code_verifier: grant.verifier,
      redirect_uri: grant.redirectUri,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    },
    { timeoutMs: DEFAULT_TIMEOUT_MS, signal: options.signal },
  )
  const reply = parseTokenReply(body, [])
  if (reply.refresh_token === undefined) {
    throw new ToolError(
      "upstream_error",
      "Google returned no refresh token; remove this app's access at https://myaccount.google.com/permissions and log in again.",
    )
  }
  return { refresh_token: reply.refresh_token, scopes: reply.scope, email: emailOf(reply.id_token) }
}

/**
 * Runs the consent of a Desktop app client: listens on the loopback interface,
 * tells the person the authorization URL and opens it in the browser (PKCE
 * `S256`, a random `state`, offline access with a forced consent), waits for
 * Google's redirect and exchanges its code for the tokens.
 *
 * A request that is not `GET /` with the right `state` is refused and ignored.
 * A decline is `declined`; another error, a missing refresh token and the time
 * limit are `upstream_error`; a cancellation is the cancelled error. The
 * listener is always closed, and what the exchange fails with is masked of the
 * code, the verifier and the client secret.
 */
export async function runConsent(options: ConsentOptions): Promise<ConsentResult> {
  const { signal, timeoutMs = DEFAULT_CONSENT_TIMEOUT_MS } = options
  if (signal?.aborted) throw cancelledError()
  const state = randomToken()
  const verifier = randomToken()
  const server = createServer()
  try {
    const redirectUri = `http://${LOOPBACK_HOST}:${await listen(server)}`
    const url = authorizeUrl(options, { redirectUri, state, verifier })
    options.notify(`Open this address in a browser to log in; it is opened for you where that works:\n${url}`)
    Promise.resolve()
      .then(() => options.openBrowser(url))
      .catch(() => options.notify("The browser could not be opened; open the address above by hand."))
    const code = await waitForCode(server, state, { timeoutMs, signal })
    await closeServer(server)
    return await exchangeCode(options, { code, verifier, redirectUri })
  } finally {
    await closeServer(server)
  }
}
