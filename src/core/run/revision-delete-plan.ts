import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { deleteRequest, staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import { shown } from "./ids"
import type { RunRevisionDeleteArgs } from "./revision-delete-args"
import { readRevisionState } from "./revision-state"
import type { RevisionView } from "./revision-view"
import { RUN_ROUTES } from "./routes"
import { readServiceState } from "./service-state"
import type { ServiceView } from "./service-view"
import { checkedRevision } from "./target"
import { runWriteSession } from "./write-session"

/** What a deletion says when the revision changed since it was read. */
const STALE_MESSAGE = staleMessage("revision", "deleted")

/** A revision deletion planned: what is sent, the revision as it was and the service it belongs to as it was. */
export type RevisionDeletePlan = ChangeSession & {
  label: string
  service: string
  revision: string
  request: ChangeRequest
  /** The revision as it was read. */
  before: RevisionView
  /** The service as it was read, whose traffic the revision must not be part of. */
  serviceBefore: ServiceView
  /** The revision's etag, which the write sends; `null` when there is none. */
  etag: string | null
  /** The service's etag, which a traffic change after the prompt moves; `null` when there is none. */
  serviceEtag: string | null
}

/**
 * Why the revision still matters to the service's traffic, as set or as
 * served: a share of it, a tag, or being the latest ready revision while
 * traffic follows the latest; `null` when nothing reaches it.
 */
function trafficReason(revision: string, service: ServiceView): string | null {
  const targets = [...service.traffic, ...service.traffic_statuses]
  const share = targets.find(
    (target) => target.type === "revision" && target.revision === revision && target.percent > 0,
  )
  if (share !== undefined) return `${share.percent}% of its traffic`
  const tagged = targets.find((target) => target.revision === revision && target.tag !== null)
  if (tagged !== undefined) return `the tag ${tagged.tag}`
  const followed = targets.some((target) => target.type === "latest" && target.percent > 0)
  return followed && service.latest_ready_revision === revision ? "the latest revision's traffic" : null
}

/**
 * Checks the ids and the label's scopes before anything is read, then reads
 * the service and the revision, which must exist, refuses a revision the
 * service's traffic still reaches, and plans the deletion, sent with the etag
 * read.
 */
export async function planRevisionDelete(args: RunRevisionDeleteArgs, ctx: ToolContext): Promise<RevisionDeletePlan> {
  const { place, service, revision } = checkedRevision(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.revisionDelete)
  const serviceState = await readServiceState(client, place, service)
  const state = await readRevisionState(client, place, service, revision)
  const reason = trafficReason(revision, serviceState.view)
  if (reason !== null) {
    throw new ToolError(
      "invalid_argument",
      `${shown(revision)} still serves ${shown(service)} (${reason}); move the traffic with google_run_traffic_set first. Nothing was deleted.`,
    )
  }
  return {
    client,
    runtime,
    place,
    label,
    service,
    revision,
    request: deleteRequest(RUN_ROUTES.revisionDelete, { ...place, service, revision }, state.etag, STALE_MESSAGE),
    before: state.view,
    serviceBefore: serviceState.view,
    etag: state.etag,
    serviceEtag: serviceState.etag,
  }
}
