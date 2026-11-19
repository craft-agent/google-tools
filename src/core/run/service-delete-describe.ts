import type { CallDescription, CallFact } from "../tool"
import { etagPin } from "./pins"
import type { ServiceDeletePlan } from "./service-delete-plan"
import { servedTraffic } from "./traffic-describe"
import { RUN_WORDS } from "./words"

/**
 * What the prompt shows of a service's deletion: the headline, its URL, the
 * traffic it serves now and its latest revision, since every revision goes
 * with it. The service's etag is a pin.
 */
export function describeServiceDelete({ service, before, etag }: ServiceDeletePlan): CallDescription {
  const facts: CallFact[] = [
    ...(before.uri === null ? [] : [{ label: RUN_WORDS.url, value: before.uri }]),
    { label: RUN_WORDS.trafficNow, value: servedTraffic(before) },
    ...(before.latest_ready_revision === null
      ? []
      : [{ label: RUN_WORDS.latestRevision, value: before.latest_ready_revision }]),
  ]
  return {
    headline: { text: RUN_WORDS.serviceDelete, values: { service } },
    facts,
    pins: etagPin(etag),
  }
}
