import type { GoogleClient } from "../google/client"
import type { Place } from "./calls"
import { readResourceState, type ResourceState } from "./resource-state"
import { RUN_ROUTES } from "./routes"
import { serviceReply, serviceView, type ServiceView } from "./service-view"

/** A service as a plan reads it (see `ResourceState`). */
export type ServiceState = ResourceState<ServiceView>

/** Reads one service for a plan; one that is gone is `not_found`. */
export function readServiceState(client: GoogleClient, place: Place, service: string): Promise<ServiceState> {
  return readResourceState(client, {
    route: RUN_ROUTES.service,
    params: { ...place, service },
    reply: serviceReply,
    view: serviceView,
    what: "a service",
  })
}
