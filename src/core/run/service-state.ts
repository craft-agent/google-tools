import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import type { Place } from "./calls"
import { RUN_ROUTES } from "./routes"
import { serviceReply, serviceView, type ServiceView } from "./service-view"

/**
 * A service as a plan reads it: Google's own JSON, which a deploy copies from
 * and sends back and so must never be returned, the view of it that holds no
 * environment value, and the etag a write sends to prove what it was made from.
 */
export type ServiceState = { raw: Record<string, unknown>; view: ServiceView; etag: string | null }

/** Reads one service for a plan; one that is gone is `not_found`. */
export async function readServiceState(client: GoogleClient, place: Place, service: string): Promise<ServiceState> {
  const raw = await client.request<Record<string, unknown>>(RUN_ROUTES.service, { params: { ...place, service } })
  const view = serviceView(parseReply(serviceReply, raw, "a service"))
  return { raw, view, etag: typeof raw.etag === "string" ? raw.etag : null }
}
