import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { resourceName } from "./ids"
import { RUN_ROUTES } from "./routes"
import type { ChangeRequest, ChangeSession } from "./service-change"
import { readServiceState } from "./service-state"
import { LATEST_ALLOCATION, REVISION_ALLOCATION, WHOLE_PERCENT, type ServiceView } from "./service-view"
import { checkedService } from "./target"
import type { RunTrafficArgs } from "./traffic-args"
import { runWriteSession } from "./write-session"

/** One target of a traffic split, as the call gives it. */
export type TrafficEntry = RunTrafficArgs["traffic"][number]

/** A traffic change planned: the split, what is sent and the service as it was. */
export type TrafficPlan = ChangeSession & {
  label: string
  service: string
  entries: TrafficEntry[]
  request: ChangeRequest
  /** The service as it was read. */
  before: ServiceView
  /** The service's etag, which the write sends; `null` when there is none. */
  etag: string | null
}

function refuse(message: string): ToolError {
  return new ToolError("invalid_argument", `${message}; nothing was changed.`)
}

/** The first value that appears twice among `values`. */
function repeated(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index)
}

/**
 * Checks a split as a whole, each revision name as the short name it must
 * be, and refuses the rest as `invalid_argument` before any request: each
 * entry names exactly one of a revision and `latest`, the percents add up to
 * 100, and no revision, `latest` or tag is used twice.
 */
function checkEntries(entries: readonly TrafficEntry[]): void {
  entries.forEach((entry, index) => {
    if ((entry.revision === undefined) === (entry.latest === undefined)) {
      throw refuse(`Traffic entry ${index + 1} must give exactly one of \`revision\` and \`latest\``)
    }
    if (entry.revision !== undefined) resourceName(entry.revision, "revision name")
  })
  const total = entries.reduce((sum, entry) => sum + entry.percent, 0)
  if (total !== WHOLE_PERCENT) throw refuse(`The percents add up to ${total}, not ${WHOLE_PERCENT}`)
  if (entries.filter((entry) => entry.latest !== undefined).length > 1) {
    throw refuse("`latest` is given more than once")
  }
  const revision = repeated(entries.flatMap((entry) => entry.revision ?? []))
  if (revision !== undefined) throw refuse(`The revision \`${revision}\` is given more than once`)
  const tag = repeated(entries.flatMap((entry) => entry.tag ?? []))
  if (tag !== undefined) throw refuse(`The tag \`${tag}\` is given more than once`)
}

/** One target of the split as Google's `traffic` field writes it. */
function targetOf(entry: TrafficEntry): Record<string, unknown> {
  const tag = entry.tag === undefined ? {} : { tag: entry.tag }
  if (entry.revision === undefined) return { type: LATEST_ALLOCATION, percent: entry.percent, ...tag }
  return { type: REVISION_ALLOCATION, revision: entry.revision, percent: entry.percent, ...tag }
}

/**
 * Checks the arguments (the ids and the split) and the label's scopes before
 * anything is read, then reads the service, which must exist, and plans the
 * write of its traffic, sent with the etag read.
 */
export async function planTraffic(args: RunTrafficArgs, ctx: ToolContext): Promise<TrafficPlan> {
  const { place, service } = checkedService(args)
  checkEntries(args.traffic)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.servicePatch)
  const state = await readServiceState(client, place, service)
  const request: ChangeRequest = {
    route: RUN_ROUTES.servicePatch,
    params: { ...place, service },
    query: { updateMask: "traffic" },
    body: { traffic: args.traffic.map(targetOf), ...(state.etag !== null && { etag: state.etag }) },
  }
  return {
    client,
    runtime,
    place,
    label,
    service,
    entries: args.traffic,
    request,
    before: state.view,
    etag: state.etag,
  }
}
