import { ToolError } from "../errors"
import { cancelledError } from "./cancelled"
import { failedReplyError, isRedirect, isSuccess, requestFailure, type HttpReply, type Transport } from "./fetch"
import { maskText } from "./mask"

const HTTP_UNAUTHORIZED = 401

/** Bytes in a MiB, which the size limit's message counts in. */
const BYTES_PER_MIB = 1024 * 1024

/** The longest content type a message repeats. */
const MAX_SHOWN_TYPE_LENGTH = 100

/** What `sendDownload` gives back for a 401 it was told to let its caller retry. */
export const UNAUTHORIZED = "unauthorized"

/** Where a download's body goes, what it must be and how much of it is taken. */
export type DownloadSink = {
  /** The content type the body must have, as a prefix (`application/pdf`). */
  accept: string
  /** The most bytes taken; a longer body is `invalid_argument`. */
  maxBytes: number
  /** Receives the body chunk by chunk, in order. */
  write: (chunk: Uint8Array) => Promise<void>
}

/** A download taken whole: how many bytes were written and the body's media type, lower case and without parameters. */
export type Downloaded = { bytes: number; contentType: string }

function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase()
}

/**
 * Sends one request and streams a successful body to `sink.write`. Like
 * `sendRequest` it never follows a redirect (`upstream_error`) and is stopped
 * by the time limit, which covers the whole body, and by `transport.signal`.
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
): Promise<Downloaded | typeof UNAUTHORIZED> {
  const { timeoutMs, signal: callerSignal } = transport
  if (callerSignal?.aborted) throw cancelledError()
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
  let writing = false
  try {
    const response = await transport.fetch(url, { ...init, redirect: "manual", signal })
    if (isRedirect(response.status)) {
      await response.body?.cancel()
      throw new ToolError(
        "upstream_error",
        "Google answered the export with a redirect, which is not followed; the account may lack the access the export needs.",
      )
    }
    if (response.status === HTTP_UNAUTHORIZED && retryUnauthorized) {
      await response.body?.cancel()
      return UNAUTHORIZED
    }
    if (!isSuccess(response.status)) {
      const reply: HttpReply = { status: response.status, text: await response.text() }
      throw failedReplyError(reply, known)
    }
    const contentType = mediaType(response.headers.get("content-type"))
    if (!contentType.startsWith(sink.accept)) {
      await response.body?.cancel()
      const shown = maskText(contentType.slice(0, MAX_SHOWN_TYPE_LENGTH), known) || "no content type"
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
    throw requestFailure(error, transport, timeout.signal.aborted, known)
  } finally {
    clearTimeout(timer)
  }
}
