import type { CallDescription, CallFact } from "../tool"
import { phrase } from "./facts"
import { revisionPins } from "./pins"
import type { RevisionDeletePlan } from "./revision-delete-plan"
import { RUN_WORDS } from "./words"

/**
 * What the prompt shows of a revision's deletion: the headline, when the
 * revision was created, its image and that it takes no traffic. The revision's
 * etag and its service's are pins.
 */
export function describeRevisionDelete({
  service,
  revision,
  before,
  etag,
  serviceEtag,
}: RevisionDeletePlan): CallDescription {
  const image = before.images[0]?.image
  const facts: CallFact[] = [
    ...(before.create_time === null ? [] : [{ label: RUN_WORDS.created, value: before.create_time }]),
    ...(image === undefined ? [] : [{ label: RUN_WORDS.image, value: image }]),
    { label: RUN_WORDS.traffic, value: phrase(RUN_WORDS.none) },
  ]
  return {
    headline: { text: RUN_WORDS.revisionDelete, values: { revision, service } },
    facts,
    pins: revisionPins(etag, serviceEtag),
  }
}
