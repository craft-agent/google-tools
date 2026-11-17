import { ToolError, isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { QueryValue, Route } from "../google/routes"
import type { ToolRuntime } from "../runtime"
import type { Place } from "./calls"
import { waitForOperation, type OperationOutcome, type WaitOptions } from "./operation-wait"
import { serviceReply, serviceView, type ServiceView } from "./service-view"

const HTTP_CONFLICT = 409
const ABORTED = "ABORTED"

/** What a change that lost a race says: nothing was changed, and what to do. */
const STALE_MESSAGE = "The service changed since it was read; nothing was changed. Read it again and retry."

/** One write a plan decided on: the route, its path parameters, query and JSON body. */
export type ChangeRequest = {
  route: Route
  params: Record<string, string>
  query?: Record<string, QueryValue>
  body: unknown
}

/** What a plan holds to send its write and follow the operation it starts. */
export type ChangeSession = { client: GoogleClient; runtime: ToolRuntime; place: Place }

/** Whether Google refused the write as a conflict: the service changed, or was made, since the plan read it. */
function isConflict(error: unknown): boolean {
  return isToolError(error) && (error.details?.status === HTTP_CONFLICT || error.details?.google_status === ABORTED)
}

/** The service an operation that is done changed, as the view gives it; `null` while it runs or when its response is not a service. */
export function changedService(outcome: OperationOutcome): ServiceView | null {
  const parsed = outcome.done ? serviceReply.safeParse(outcome.response) : undefined
  return parsed?.success ? serviceView(parsed.data) : null
}

/**
 * Sends the plan's write and waits for its operation (see
 * `waitForOperation`). A conflict is `stale`, since the plan was made from a
 * read the service has moved on from.
 */
export async function sendChange(
  { client, runtime, place }: ChangeSession,
  request: ChangeRequest,
  signal: AbortSignal | undefined,
  wait?: WaitOptions,
): Promise<OperationOutcome> {
  let started: unknown
  try {
    started = await client.request(request.route, {
      params: request.params,
      query: request.query,
      body: request.body,
    })
  } catch (error) {
    throw isConflict(error) ? new ToolError("stale", STALE_MESSAGE, { cause: error }) : error
  }
  return waitForOperation(client, runtime, place, started, signal, wait)
}
