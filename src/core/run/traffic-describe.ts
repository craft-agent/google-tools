import type { CallDescription, CallFact } from "../tool"
import { countFact, phrase } from "./facts"
import { etagPin } from "./pins"
import type { ServiceView } from "./service-view"
import type { TrafficEntry, TrafficPlan } from "./traffic-plan"
import { RUN_WORDS } from "./words"

type Served = ServiceView["traffic_statuses"][number]

/** What a target is called: its revision, or `latest` with the revision it follows when Google says which. */
function targetName({ type, revision }: Served): string {
  if (type === "revision") return revision ?? ""
  return revision === null ? "latest" : `latest (${revision})`
}

/** The traffic the service serves, as `rev-a 90%, rev-b 10%`. */
export function servedTraffic({ traffic_statuses }: ServiceView): CallFact["value"] {
  return traffic_statuses.length === 0
    ? phrase(RUN_WORDS.noTraffic)
    : traffic_statuses.map((target) => `${targetName(target)} ${target.percent}%`).join(", ")
}

/** The `Now` fact: the traffic the service serves. */
function servedFact(service: ServiceView): CallFact {
  return { label: RUN_WORDS.now, value: servedTraffic(service) }
}

/** The tags the service has now, each once: a split replaces them all. */
function tagsOf({ traffic, traffic_statuses }: ServiceView): string[] {
  return [...new Set([...traffic, ...traffic_statuses].flatMap((target) => target.tag ?? []))]
}

/** The line of one entry: its revision or `latest`, its share and its tag. */
function entryLine({ revision, percent, tag }: TrafficEntry): string {
  return `${revision ?? "latest"}: ${percent}%${tag === undefined ? "" : ` (tag ${tag})`}`
}

/**
 * What the prompt shows of a traffic change: the headline, the traffic the
 * service serves now and how many tags it has (which the split drops unless it
 * names them), and the new split, a line per entry. The service's etag is a pin.
 */
export function describeTraffic({ service, before, entries, etag }: TrafficPlan): CallDescription {
  const tags = tagsOf(before)
  return {
    headline: { text: RUN_WORDS.trafficSet, values: { service } },
    facts: [
      servedFact(before),
      ...(tags.length > 0 ? [countFact(RUN_WORDS.tags, tags.length, RUN_WORDS.tagOne, RUN_WORDS.tagMany)] : []),
    ],
    text: { label: RUN_WORDS.newTraffic, body: entries.map(entryLine).join("\n") },
    pins: etagPin(etag),
  }
}
