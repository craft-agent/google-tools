import type { z } from "zod"
import { ToolError, isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { QueryValue, Route } from "../google/routes"
import type { ToolRuntime } from "../runtime"
import type { Place } from "./calls"
import type { ContainerView } from "./container-view"
import { waitForOperation, type OperationOutcome, type WaitOptions } from "./operation-wait"

const HTTP_CONFLICT = 409
const ABORTED = "ABORTED"

/** What a change that lost a race says: nothing was done, and what to do. */
export function staleMessage(subject: string, done: string): string {
  return `The ${subject} changed since it was read; nothing was ${done}. Read it again and retry.`
}

/** What a write on a service says when it lost a race, unless its request names another. */
const SERVICE_STALE_MESSAGE = staleMessage("service", "changed")

/** One write a plan decided on: the route, its path parameters, query and JSON body, and what it says when Google answers with a conflict (a service's, unless given). */
export type ChangeRequest = {
  route: Route
  params: Record<string, string>
  query?: Record<string, QueryValue>
  body: unknown
  stale?: string
}

/** A deletion of the resource `route` and `params` name, sent with the etag read as the `etag` query when there is one. */
export function deleteRequest(
  route: Route,
  params: Record<string, string>,
  etag: string | null,
  stale: string,
): ChangeRequest {
  return { route, params, ...(etag !== null && { query: { etag } }), body: undefined, stale }
}

/** What a plan holds to send its write and follow the operation it starts. */
export type ChangeSession = { client: GoogleClient; runtime: ToolRuntime; place: Place }

/** Whether Google refused the write as a conflict: the resource changed, or was made, since the plan read it. */
function isConflict(error: unknown): boolean {
  return isToolError(error) && (error.details?.status === HTTP_CONFLICT || error.details?.google_status === ABORTED)
}

/** The resource an operation that is done changed, as `view` gives it; `null` while it runs or when its response is not one `reply` reads. */
export function changed<Reply extends z.ZodType, View>(
  outcome: OperationOutcome,
  reply: Reply,
  view: (parsed: z.output<Reply>) => View,
): View | null {
  const parsed = outcome.done ? reply.safeParse(outcome.response) : undefined
  return parsed?.success ? view(parsed.data) : null
}

/** The operation of an outcome as a result reports it: its id and whether it was done. */
export function operationReport({ operation, done }: OperationOutcome): { operation: string; done: boolean } {
  return { operation, done }
}

/** What a deploy was before, for its result: the changed container's image and the template as read; `null` when the resource was created. */
export function beforeChange<Template>(
  before: { template: Template } | null,
  container: ContainerView | null,
): { image: string; template: Template } | null {
  return before !== null && container !== null ? { image: container.image, template: before.template } : null
}

/**
 * Sends the plan's write and returns Google's reply, the operation it started.
 * A conflict is `stale`, since the plan was made from a read the resource has
 * moved on from.
 */
export async function startChange(client: GoogleClient, request: ChangeRequest): Promise<unknown> {
  try {
    return await client.request(request.route, {
      params: request.params,
      query: request.query,
      body: request.body,
    })
  } catch (error) {
    throw isConflict(error) ? new ToolError("stale", request.stale ?? SERVICE_STALE_MESSAGE, { cause: error }) : error
  }
}

/** Sends the plan's write (see `startChange`) and waits for its operation (see `waitForOperation`). */
export async function sendChange(
  { client, runtime, place }: ChangeSession,
  request: ChangeRequest,
  signal: AbortSignal | undefined,
  wait?: WaitOptions,
): Promise<OperationOutcome> {
  const started = await startChange(client, request)
  return waitForOperation(client, runtime, place, started, signal, wait)
}
