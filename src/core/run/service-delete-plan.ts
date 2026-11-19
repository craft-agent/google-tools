import type { ToolContext } from "../tool"
import { deleteRequest, staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import { RUN_ROUTES } from "./routes"
import type { RunServiceDeleteArgs } from "./service-delete-args"
import { readServiceState } from "./service-state"
import type { ServiceView } from "./service-view"
import { checkedService } from "./target"
import { runWriteSession } from "./write-session"

/** What a deletion says when the service changed since it was read. */
const STALE_MESSAGE = staleMessage("service", "deleted")

/** A service deletion planned: what is sent and the service as it was. */
export type ServiceDeletePlan = ChangeSession & {
  label: string
  service: string
  request: ChangeRequest
  /** The service as it was read. */
  before: ServiceView
  /** The service's etag, which the write sends; `null` when there is none. */
  etag: string | null
}

/**
 * Checks the ids and the label's scopes before anything is read, then reads
 * the service, which must exist, and plans the deletion, sent with the etag
 * read.
 */
export async function planServiceDelete(args: RunServiceDeleteArgs, ctx: ToolContext): Promise<ServiceDeletePlan> {
  const { place, service } = checkedService(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.serviceDelete)
  const state = await readServiceState(client, place, service)
  return {
    client,
    runtime,
    place,
    label,
    service,
    request: deleteRequest(RUN_ROUTES.serviceDelete, { ...place, service }, state.etag, STALE_MESSAGE),
    before: state.view,
    etag: state.etag,
  }
}
