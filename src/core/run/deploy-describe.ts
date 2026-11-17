import type { CallDescription, CallFact, CallHeadline } from "../tool"
import { SETTINGS, changeLines, containerLines, containerPins, keptFacts, textOf } from "./container-describe"
import type { DeployPlan } from "./deploy-plan"
import { phrase } from "./facts"
import { etagPin } from "./pins"
import { WHOLE_PERCENT, type ServiceView } from "./service-view"
import { timeoutText } from "./timeout"
import { RUN_WORDS } from "./words"

/** The words that begin a line of the changes, one per setting only a service has. */
const SERVICE_SETTINGS = {
  minInstances: "min instances",
  maxInstances: "max instances",
  concurrency: "concurrency",
  port: "port",
} as const

function headline({ mode, service, args }: DeployPlan): CallHeadline {
  const text = mode === "create" ? RUN_WORDS.deployCreate : RUN_WORDS.deployUpdate
  return { text, values: { image: args.image, service } }
}

/** Whether a new revision of the service takes all its traffic: the service follows its latest revision, or has no traffic set. */
function followsLatest({ traffic }: ServiceView): boolean {
  const [only] = traffic
  return traffic.length === 0 || (traffic.length === 1 && only?.type === "latest" && only.percent === WHOLE_PERCENT)
}

/** What a deploy keeps of the service that matters to who may approve it: its identity, secrets, volumes and network. */
function serviceKeptFacts({ template, ingress }: ServiceView): CallFact[] {
  const facts = keptFacts(template)
  if (ingress !== null && ingress !== "all") facts.push({ label: RUN_WORDS.ingress, value: ingress })
  return facts
}

function facts({ before, container }: DeployPlan): CallFact[] {
  if (before === null || container === null) {
    return [
      { label: RUN_WORDS.newService, value: phrase(RUN_WORDS.newServiceDefaults) },
      { label: RUN_WORDS.traffic, value: phrase(RUN_WORDS.trafficLatest) },
    ]
  }
  return [
    {
      label: RUN_WORDS.traffic,
      value: phrase(followsLatest(before) ? RUN_WORDS.trafficLatest : RUN_WORDS.trafficKept),
    },
    { label: RUN_WORDS.imageNow, value: container.image },
    ...serviceKeptFacts(before),
  ]
}

/**
 * The lines of the changes, in a fixed order: the image, each variable (named,
 * never its value), then each setting the call gives. On an update a line
 * reads `<old> → <new>`, with `-` for what was not set; on a new service, only
 * the new value.
 */
function changeTexts({ args, before, container }: DeployPlan): string[] {
  const template = before?.template
  const lines = changeLines(before !== null && container !== null)
  const { setting } = lines

  return [
    ...containerLines(args, container, lines),
    ...setting(SERVICE_SETTINGS.minInstances, textOf(template?.min_instances), args.min_instances),
    ...setting(SERVICE_SETTINGS.maxInstances, textOf(template?.max_instances), args.max_instances),
    ...setting(
      SETTINGS.timeout,
      textOf(template?.timeout),
      args.timeout_seconds === undefined ? undefined : timeoutText(args.timeout_seconds),
    ),
    ...setting(SERVICE_SETTINGS.concurrency, textOf(template?.concurrency), args.concurrency),
    ...setting(SERVICE_SETTINGS.port, textOf(container?.ports[0]?.container_port), args.port),
  ]
}

/**
 * What the prompt shows of a deploy: the headline, what happens to traffic,
 * the image now and what the deploy keeps (or, for a new service, the
 * defaults it gets), and every change as a line, with no variable's value.
 * The service's etag, the container's name and a digest of its variables'
 * names and kinds are pins.
 */
export function describeDeploy(plan: DeployPlan): CallDescription {
  const { args, container, etag } = plan
  return {
    headline: headline(plan),
    facts: facts(plan),
    text: { label: RUN_WORDS.changes, body: changeTexts(plan).join("\n") },
    pins: { ...etagPin(etag), ...containerPins(container, args.container) },
  }
}
