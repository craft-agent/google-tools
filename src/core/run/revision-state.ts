import type { GoogleClient } from "../google/client"
import type { Place } from "./calls"
import { readResourceState, type ResourceState } from "./resource-state"
import { revisionReply, revisionView, type RevisionView } from "./revision-view"
import { RUN_ROUTES } from "./routes"

/** A revision as a plan reads it (see `ResourceState`). */
export type RevisionState = ResourceState<RevisionView>

/** Reads one revision of a service for a plan; one that is gone is `not_found`. */
export function readRevisionState(
  client: GoogleClient,
  place: Place,
  service: string,
  revision: string,
): Promise<RevisionState> {
  return readResourceState(client, {
    route: RUN_ROUTES.revision,
    params: { ...place, service, revision },
    reply: revisionReply,
    view: revisionView,
    what: "a revision",
  })
}
