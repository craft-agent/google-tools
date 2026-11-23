import { ToolError } from "../errors"
import { cancelledError } from "./cancelled"
import { failedReplyError, isRedirect, isSuccess, requestFailure, type Transport } from "./fetch"
import { handoffAddress, handoffSecrets } from "./handoff"
import { maskText } from "./mask"
import type { Handoff } from "./routes"

const HTTP_UNAUTHORIZED = 401

/** Bytes in a MiB, which the size limit's message counts in. */
const BYTES_PER_MIB = 1024 * 1024

/** The longest content type a message repeats. */
const MAX_SHOWN_TYPE_LENGTH = 100

/** What a redirect that is not a handoff's says; it names no address. */
const REDIRECT_REFUSED_MESSAGE = "Google answered with a redirect, which is not followed; nothing was fetched from it."

/** What a redirect from the handoff address says. */
const HANDOFF_REDIRECT_MESSAGE = "Google's download address answered with another redirect, which is not followed."

/** What `sendDownload` gives back for a 401 it was told to let its caller retry. */
export const UNAUTHORIZED = "unauthorized"

/** Where a download's body goes, what it must be and how much of it is taken. */
export type DownloadSink = {
  /** The content type the body must have, as a prefix (`application/pdf`). */
  accept: string
  /** The most bytes taken; a longer body is `invalid_argument`. */
  maxBytes: number
  /** What the `invalid_argument` of a body over `maxBytes` says; left out, it says the export is over the limit and to snapshot a smaller range. */
  limitMessage?: string
  /** Receives the body chunk by chunk, in order. */
  write: (chunk: Uint8Array) => Promise<void>
}

/** A download taken whole: how many bytes were written and the body's media type, lower case and without parameters. */
export type Downloaded = { bytes: number; contentType: string }

function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase()
}

/** The only header a handoff address gets: the `Accept` of the request that was handed off. */
function acceptOnly(init: RequestInit): Headers {
  const headers = new Headers()
  const accept = new Headers(init.headers).get("accept")
  if (accept !== null) headers.set("Accept", accept)
  return headers
}

/**
 * Sends one request and streams a successful body to `sink.write`. Like
 * `sendRequest` it follows no redirect but `handoff`'s (any other is
 * `upstream_error`, and nothing is fetched from it) and is stopped by the time
 * limit, which covers the whole body, and by `transport.signal`.
 *
 * A redirect answering a request with a `handoff` is followed once, when its
 * address is the handoff's (see `handoffAddress`): the address gets a bare GET
 * with the request's `Accept` and nothing else, never the token, and its own
 * redirect is refused. Its answer is read like any other, except that a 401
 * from it is never `UNAUTHORIZED`, since no token was sent. The address is
 * masked, signed query included, from every message of the download.
 *
 * A failure status throws what `googleError` maps it to, its body read as text
 * and masked with `known`; a 401 returns `UNAUTHORIZED` when `retryUnauthorized`
 * is set, before anything is written. A success whose content type does not
 * start with `sink.accept` is `upstream_error` naming the type only; a body
 * over `sink.maxBytes` stops the read as `invalid_argument` with its last
 * chunk unwritten. An error `write` throws passes as it is.
 */
export async function sendDownload(
  transport: Transport,
  url: string,
  init: RequestInit,
  known: readonly string[],
  sink: DownloadSink,
  retryUnauthorized: boolean,
  handoff: Handoff | undefined,
): Promise<Downloaded | typeof UNAUTHORIZED> {
  const { timeoutMs, signal: callerSignal } = transport
  if (callerSignal?.aborted) throw cancelledError()
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
  let masked = known
  let writing = false
  try {
    let response = await transport.fetch(url, { ...init, redirect: "manual", signal })
    let handedOff = false
    if (isRedirect(response.status)) {
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!handoff) throw new ToolError("upstream_error", REDIRECT_REFUSED_MESSAGE)
      const address = handoffAddress(location, handoff)
      masked = [...known, ...handoffSecrets(location!, address)]
      response = await transport.fetch(address.href, {
        method: "GET",
        headers: acceptOnly(init),
        redirect: "manual",
        signal,
      })
      handedOff = true
    }
    if (isRedirect(response.status)) {
      await response.body?.cancel()
      throw new ToolError("upstream_error", handedOff ? HANDOFF_REDIRECT_MESSAGE : REDIRECT_REFUSED_MESSAGE)
    }
    if (response.status === HTTP_UNAUTHORIZED && retryUnauthorized && !handedOff) {
      await response.body?.cancel()
      return UNAUTHORIZED
    }
    if (!isSuccess(response.status)) {
      const failure = failedReplyError({ status: response.status, text: await response.text() }, masked)
      // No token went to the handoff address, so its 401 says nothing about the label's login.
      if (handedOff && failure instanceof ToolError && failure.code === "unauthenticated") {
        throw new ToolError("upstream_error", failure.message, { details: { ...failure.details } })
      }
      throw failure
    }
    const contentType = mediaType(response.headers.get("content-type"))
    if (!contentType.startsWith(sink.accept)) {
      await response.body?.cancel()
      const shown = maskText(contentType.slice(0, MAX_SHOWN_TYPE_LENGTH), masked) || "no content type"
      throw new ToolError("upstream_error", `Google answered the export with ${shown} instead of ${sink.accept}.`)
    }
    let bytes = 0
    const reader = response.body?.getReader()
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > sink.maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ToolError(
          "invalid_argument",
          sink.limitMessage ??
            `The export is over ${Math.floor(sink.maxBytes / BYTES_PER_MIB)} MiB; snapshot a smaller range.`,
        )
      }
      writing = true
      await sink.write(value)
      writing = false
    }
    return { bytes, contentType }
  } catch (error) {
    if (writing || error instanceof ToolError) throw error
    throw requestFailure(error, transport, timeout.signal.aborted, masked)
  } finally {
    clearTimeout(timer)
  }
}
