import { ToolError } from "../errors"
import { cancelledError } from "./cancelled"
import { googleError } from "./google-errors"
import { maskError, maskText } from "./mask"

/** The `fetch` the client calls through; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** How long one call may wait for Google, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1000

const HTTP_OK_MIN = 200
const HTTP_REDIRECT_MIN = 300
const HTTP_REDIRECT_MAX = 399

/** Names Google in the messages of its failures. */
const SUBJECT = "Google"

/** What a call needs besides its request: the `fetch`, its time limit and the caller's cancellation. */
export type Transport = {
  fetch: FetchLike
  timeoutMs: number
  signal?: AbortSignal
}

/** An answer that was not a redirect: its status and its whole body. */
export type HttpReply = {
  status: number
  text: string
}

function isRedirect(status: number): boolean {
  return status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Sends one request and reads its whole answer. The request is sent with
 * `redirect: "manual"`, is stopped by the time limit and by `transport.signal`,
 * and fails as `upstream_error`: a redirect, which is never followed; a time
 * limit passed; a cancellation ("The call was cancelled."); a network failure,
 * whose message is masked with `known` and shown without its cause.
 */
export async function sendRequest(
  transport: Transport,
  url: string,
  init: RequestInit,
  known: readonly string[],
): Promise<HttpReply> {
  const { timeoutMs, signal: callerSignal } = transport
  if (callerSignal?.aborted) throw cancelledError()
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
  let reply: HttpReply
  try {
    const response = await transport.fetch(url, { ...init, redirect: "manual", signal })
    if (isRedirect(response.status)) {
      await response.body?.cancel()
      reply = { status: response.status, text: "" }
    } else {
      reply = { status: response.status, text: await response.text() }
    }
  } catch (error) {
    if (callerSignal?.aborted) throw cancelledError()
    if (timeout.signal.aborted) {
      throw new ToolError("upstream_error", `${SUBJECT} did not answer within ${timeoutMs / MS_PER_SECOND} s`)
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new ToolError("upstream_error", `${SUBJECT} could not be reached: ${maskText(reason, known)}`)
  } finally {
    clearTimeout(timer)
  }
  if (isRedirect(reply.status)) {
    throw new ToolError("upstream_error", `${SUBJECT} answered with a redirect, which is never followed`)
  }
  return reply
}

/**
 * The parsed JSON of a successful `reply` (an empty body is `{}`). A failure
 * status throws the error `googleError` maps it to, masked with `known`; a
 * successful body that is not JSON throws `upstream_error`. A success body is
 * returned as it is: masking it is the caller's.
 */
export function readReply(reply: HttpReply, known: readonly string[]): unknown {
  const body = parseBody(reply.text)
  if (reply.status < HTTP_OK_MIN || reply.status >= HTTP_REDIRECT_MIN) {
    throw maskError(googleError(reply.status, body, SUBJECT), known)
  }
  if (body === undefined) {
    throw new ToolError("upstream_error", `${SUBJECT} answered with a body that is not JSON.`)
  }
  return body
}
