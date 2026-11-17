import { createHash } from "node:crypto"
import type { CallDescription, CallFact, CallHeadline } from "../tool"
import type { ContainerView } from "./container-view"
import type { DeployPlan } from "./deploy-plan"
import { countFact, phrase } from "./facts"
import { etagPin } from "./pins"
import { WHOLE_PERCENT, type ServiceView } from "./service-view"
import { RUN_WORDS } from "./words"

/** The pins of a deploy beside the etag: the container changed and a digest of its variables' names and kinds. */
const CONTAINER_PIN = "container"
const ENV_PIN = "env"

/** What a line of the changes shows for a value that was not set. */
const UNSET = "-"

/** The words that begin a line of the changes, one per setting. */
const SETTINGS = {
  image: "image",
  command: "command",
  args: "args",
  cpu: "cpu",
  memory: "memory",
  minInstances: "min instances",
  maxInstances: "max instances",
  timeout: "timeout",
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
function keptFacts({ template, ingress }: ServiceView): CallFact[] {
  const secrets = template.containers.flatMap((container) => container.env).filter((env) => env.kind === "secret")
  const facts: CallFact[] = [
    { label: RUN_WORDS.runsAs, value: template.service_account ?? phrase(RUN_WORDS.defaultAccount) },
  ]
  if (secrets.length > 0) {
    facts.push(countFact(RUN_WORDS.secretVariables, secrets.length, RUN_WORDS.variableOne, RUN_WORDS.variableMany))
  }
  if (template.volumes.length > 0) {
    facts.push(countFact(RUN_WORDS.volumes, template.volumes.length, RUN_WORDS.volumeOne, RUN_WORDS.volumeMany))
  }
  if (template.vpc_access !== null) {
    facts.push({ label: RUN_WORDS.vpcAccess, value: template.vpc_access.connector ?? phrase(RUN_WORDS.vpcSet) })
  }
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
    ...keptFacts(before),
  ]
}

const textOf = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value)

const listOf = (items: readonly string[]): string | null => (items.length === 0 ? null : JSON.stringify(items))

/**
 * The lines of the changes, in a fixed order: the image, each variable (named,
 * never its value), then each setting the call gives. On an update a line
 * reads `<old> → <new>`, with `-` for what was not set; on a new service, only
 * the new value.
 */
function changeLines({ args, before, container }: DeployPlan): string[] {
  const update = before !== null && container !== null
  const template = before?.template
  const line = (setting: string, old: string | null, value: string) =>
    update ? `${setting}: ${old ?? UNSET} → ${value}` : `${setting}: ${value}`
  const setting = (name: string, old: string | null, value: string | number | string[] | undefined) =>
    value === undefined ? [] : [line(name, old, Array.isArray(value) ? JSON.stringify(value) : String(value))]

  return [
    line(SETTINGS.image, textOf(container?.image), args.image),
    ...Object.entries(args.env ?? {}).map(([name, value]) => `env ${name}: ${value === null ? "removed" : "set"}`),
    ...setting(SETTINGS.command, listOf(container?.command ?? []), args.command),
    ...setting(SETTINGS.args, listOf(container?.args ?? []), args.args),
    ...setting(SETTINGS.cpu, textOf(container?.resources.cpu), args.cpu),
    ...setting(SETTINGS.memory, textOf(container?.resources.memory), args.memory),
    ...setting(SETTINGS.minInstances, textOf(template?.min_instances), args.min_instances),
    ...setting(SETTINGS.maxInstances, textOf(template?.max_instances), args.max_instances),
    ...setting(
      SETTINGS.timeout,
      textOf(template?.timeout),
      args.timeout_seconds === undefined ? undefined : `${args.timeout_seconds}s`,
    ),
    ...setting(SETTINGS.concurrency, textOf(template?.concurrency), args.concurrency),
    ...setting(SETTINGS.port, textOf(container?.ports[0]?.container_port), args.port),
  ]
}

/** One digest of the names and kinds of a container's variables, so a variable turned into a secret since the prompt is a change. */
function envDigest(container: ContainerView | null): string {
  return createHash("sha256")
    .update((container?.env ?? []).map(({ name, kind }) => `${name}:${kind}`).join("\n"))
    .digest("hex")
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
    text: { label: RUN_WORDS.changes, body: changeLines(plan).join("\n") },
    pins: {
      ...etagPin(etag),
      [CONTAINER_PIN]: container?.name ?? args.container ?? "",
      [ENV_PIN]: envDigest(container),
    },
  }
}
