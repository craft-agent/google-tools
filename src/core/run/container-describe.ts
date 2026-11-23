import { createHash } from "node:crypto"
import type { CallFact } from "../tool"
import type { ContainerArgs } from "./container-change"
import type { ContainerView } from "./container-view"
import { countFact, phrase } from "./facts"
import type { TemplateSettings } from "./template-view"
import { RUN_WORDS } from "./words"

/** The pins of a deploy beside the etag: the container changed and a digest of its variables' names and kinds. */
const CONTAINER_PIN = "container"
const ENV_PIN = "env"

/** What a line of the changes shows for a value that was not set. */
const UNSET = "-"

/** What the image line adds when the call deploys the image the container runs now, which still makes a new revision. */
const IMAGE_AGAIN = "again; a tag takes the digest it points to now"

/** The words that begin a line of the changes, one per setting a service and a job share. */
export const SETTINGS = {
  image: "image",
  command: "command",
  args: "args",
  cpu: "cpu",
  memory: "memory",
  timeout: "timeout",
} as const

export const textOf = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value)

const listOf = (items: readonly string[]): string | null => (items.length === 0 ? null : JSON.stringify(items))

/** The writers of a deploy's change lines: on an update a line reads `<old> → <new>`, with `-` for what was not set; on a new resource, only the new value. */
export type ChangeLines = {
  line: (setting: string, old: string | null, value: string) => string
  setting: (name: string, old: string | null, value: string | number | string[] | undefined) => string[]
}

export function changeLines(update: boolean): ChangeLines {
  const line = (setting: string, old: string | null, value: string) =>
    update ? `${setting}: ${old ?? UNSET} → ${value}` : `${setting}: ${value}`
  const setting = (name: string, old: string | null, value: string | number | string[] | undefined) =>
    value === undefined ? [] : [line(name, old, Array.isArray(value) ? JSON.stringify(value) : String(value))]
  return { line, setting }
}

/** The lines of the changes a call makes on its container: the image, each variable (named, never its value), then the command, arguments and limits it gives. */
export function containerLines(
  args: ContainerArgs,
  container: ContainerView | null,
  { line, setting }: ChangeLines,
): string[] {
  return [
    container?.image === args.image
      ? `${SETTINGS.image}: ${args.image} (${IMAGE_AGAIN})`
      : line(SETTINGS.image, textOf(container?.image), args.image),
    ...Object.entries(args.env ?? {}).map(([name, value]) => `env ${name}: ${value === null ? "removed" : "set"}`),
    ...setting(SETTINGS.command, listOf(container?.command ?? []), args.command),
    ...setting(SETTINGS.args, listOf(container?.args ?? []), args.args),
    ...setting(SETTINGS.cpu, textOf(container?.resources.cpu), args.cpu),
    ...setting(SETTINGS.memory, textOf(container?.resources.memory), args.memory),
  ]
}

/** What a deploy keeps of a template that matters to who may approve it: its identity, secrets, volumes and network access. */
export function keptFacts(template: TemplateSettings): CallFact[] {
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
  return facts
}

/** One digest of the names and kinds of a container's variables, so a variable turned into a secret since the prompt is a change. */
function envDigest(container: ContainerView | null): string {
  return createHash("sha256")
    .update((container?.env ?? []).map(({ name, kind }) => `${name}:${kind}`).join("\n"))
    .digest("hex")
}

/** The pin of a container's variables. */
export function envPin(container: ContainerView | null): Record<string, string> {
  return { [ENV_PIN]: envDigest(container) }
}

/** The pins of a deploy beside the etag: the container the call changes (as read, else as named) and its variables. */
export function containerPins(container: ContainerView | null, named: string | undefined): Record<string, string> {
  return { [CONTAINER_PIN]: container?.name ?? named ?? "", ...envPin(container) }
}
