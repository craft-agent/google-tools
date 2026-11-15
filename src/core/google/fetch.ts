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

/** Whether `status` is a redirect, which the client never follows. */
export function isRedirect(status: number): boolean {
  return status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX
}

/** Whether `status` is a success. */
export function isSuccess(status: number): boolean {
  return status >= HTTP_OK_MIN && status < HTTP_REDIRECT_MIN
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
 * The `upstream_error` for a request that failed before or while Google
 * answered: a cancellation ("The call was cancelled."), the time limit
 * (`timedOut`) or a network failure, whose message is masked with `known` and
 * shown without its cause.
 */
export function requestFailure(
  error: unknown,
  transport: Transport,
  timedOut: boolean,
  known: readonly string[],
): ToolError {
  if (transport.signal?.aborted) return cancelledError()
  if (timedOut) {
    return new ToolError("upstream_error", `${SUBJECT} did not answer within ${transport.timeoutMs / MS_PER_SECOND} s`)
  }
  const reason = error instanceof Error ? error.message : String(error)
  return new ToolError("upstream_error", `${SUBJECT} could not be reached: ${maskText(reason, known)}`)
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
    throw requestFailure(error, transport, timeout.signal.aborted, known)
  } finally {
    clearTimeout(timer)
  }
  if (isRedirect(reply.status)) {
    throw new ToolError("upstream_error", `${SUBJECT} answered with a redirect, which is never followed`)
  }
  return reply
}

/** The error `googleError` maps the failure `reply` to, masked with `known`. */
export function failedReplyError(reply: HttpReply, known: readonly string[]): unknown {
  return maskError(googleError(reply.status, parseBody(reply.text), SUBJECT), known)
}

/**
 * The parsed JSON of a successful `reply` (an empty body is `{}`). A failure
 * status throws the error `googleError` maps it to, masked with `known`; a
 * successful body that is not JSON throws `upstream_error`. A success body is
 * returned as it is: masking it is the caller's.
 */
export function readReply(reply: HttpReply, known: readonly string[]): unknown {
  const body = parseBody(reply.text)
  if (!isSuccess(reply.status)) throw failedReplyError(reply, known)
  if (body === undefined) {
    throw new ToolError("upstream_error", `${SUBJECT} answered with a body that is not JSON.`)
  }
  return body
}
