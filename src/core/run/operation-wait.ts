import { z } from "zod"
import { ToolError, isAbortError, isToolError, type ErrorDetails } from "../errors"
import type { GoogleClient } from "../google/client"
import { abortableSleep } from "../google/sleep"
import type { ToolRuntime } from "../runtime"
import { parseReply } from "../sheets/reply"
import type { Place } from "./calls"
import { shortName } from "./names"
import { RUN_ROUTES } from "./routes"

/** How long a write waits for its operation, and how often it asks, unless a call says otherwise. */
const DEFAULT_WAIT_MS = 120_000
const DEFAULT_POLL_MS = 3_000

/** The text of an operation that failed without giving one. */
const NO_REASON = "no reason was given"

/** How long to wait for an operation and how often to ask; only tests set them, since no argument carries them. */
export type WaitOptions = { waitMs?: number; pollMs?: number }

/** What a write's wait found: the operation's id and, once it is done, the response, the changed resource as Google gives it. */
export type OperationOutcome = { operation: string; done: true; response: unknown } | { operation: string; done: false }

/** A `google.longrunning.Operation` as a write and `operations.get` give it. */
const operationReply = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
  response: z.unknown().optional(),
})

type OperationReply = z.infer<typeof operationReply>

/** A message without its final full stop, so a sentence can follow it. */
const withoutFinalStop = (message: string) => message.replace(/\.+$/, "")

/** The outcome of a finished operation: its response, or `upstream_error` with Google's message when it failed. */
function outcomeOf(operation: string, reply: OperationReply): OperationOutcome {
  const { error } = reply
  if (error === undefined) return { operation, done: true, response: reply.response }
  const details: ErrorDetails = { operation }
  if (error.code !== undefined) details.google_code = error.code
  throw new ToolError(
    "upstream_error",
    `Google reported the change failed: ${withoutFinalStop(error.message ?? NO_REASON)}. Read the service to see what was left.`,
    { details },
  )
}

/** What a person does about a change Google started and the call could not follow to its end. */
const FOLLOW_UP = "Follow it with google_run_read method `operation` before trying again."

/**
 * The error of a wait that went wrong after Google accepted the change, so it
 * never reads as if nothing happened: a cancellation is `upstream_error`, any
 * other `ToolError` keeps its code and its message, and both name the
 * operation. Anything that is not a `ToolError` is a bug and passes as it is.
 */
function startedError(operation: string, error: unknown, signal: AbortSignal | undefined): unknown {
  if (isAbortError(error) || signal?.aborted) {
    return new ToolError(
      "upstream_error",
      `The call was cancelled after Google started the change (operation ${operation}). ${FOLLOW_UP}`,
      { cause: error, details: { operation } },
    )
  }
  if (!isToolError(error)) return error
  return new ToolError(
    error.code,
    `Google started the change (operation ${operation}), but following it failed: ${withoutFinalStop(error.message)}. ${FOLLOW_UP}`,
    { cause: error, details: { ...error.details, operation } },
  )
}

/** Sleeps `ms`, then asks for the operation once. */
async function poll(
  client: GoogleClient,
  place: Place,
  operation: string,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<OperationReply> {
  await abortableSleep(ms, signal)
  return parseReply(
    operationReply,
    await client.request(RUN_ROUTES.operation, { params: { ...place, operation } }),
    "an operation",
  )
}

/**
 * Follows the operation a write returned (`started`, Google's reply to it): a
 * reply that is done is used as it is, else `operations.get` is asked every
 * `pollMs` until it is done or `waitMs` has passed on the runtime's clock. A
 * failed operation is `upstream_error`; one still running at the deadline is
 * returned as its id with `done: false`, for the caller to say how to follow it.
 * A poll that fails, or a cancellation while waiting, is an error that says
 * the change was started and names the operation (see `startedError`).
 */
export async function waitForOperation(
  client: GoogleClient,
  runtime: ToolRuntime,
  place: Place,
  started: unknown,
  signal: AbortSignal | undefined,
  { waitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS }: WaitOptions = {},
): Promise<OperationOutcome> {
  const first = parseReply(operationReply, started, "the change")
  const operation = shortName(first.name)
  if (operation === "") {
    throw new ToolError(
      "upstream_error",
      "Google accepted the change but named no operation to follow. Read the service to see what was left.",
    )
  }

  const deadline = runtime.now() + waitMs
  let reply = first
  while (reply.done !== true) {
    const remaining = deadline - runtime.now()
    if (remaining <= 0) return { operation, done: false }
    try {
      reply = await poll(client, place, operation, Math.min(pollMs, remaining), signal)
    } catch (error) {
      throw startedError(operation, error, signal)
    }
  }
  return outcomeOf(operation, reply)
}
