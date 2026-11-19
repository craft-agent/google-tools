import type { GoogleClient } from "../google/client"
import type { Place } from "./calls"
import { executionReply, executionView, type ExecutionView } from "./execution-view"
import { readResourceState, type ResourceState } from "./resource-state"
import { RUN_ROUTES } from "./routes"

/** An execution as a plan reads it (see `ResourceState`). */
export type ExecutionState = ResourceState<ExecutionView>

/** Reads one execution for a plan; one that is gone is `not_found`. */
export function readExecutionState(
  client: GoogleClient,
  place: Place,
  job: string,
  execution: string,
): Promise<ExecutionState> {
  return readResourceState(client, {
    route: RUN_ROUTES.execution,
    params: { ...place, job, execution },
    reply: executionReply,
    view: executionView,
    what: "an execution",
  })
}
