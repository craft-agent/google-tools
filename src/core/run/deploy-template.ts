import { isRecord } from "../describe"
import { ToolError } from "../errors"
import { MASK } from "../google/mask"
import type { RunDeployArgs } from "./deploy-args"
import { shown } from "./ids"

/** A JSON object of Google's, which the deploy copies and changes in place. */
type Json = Record<string, unknown>

/** How a request timeout is written, as seconds. */
const timeoutText = (seconds: number) => `${seconds}s`

/** The member `key` of `parent` as an object, made when it is missing. */
function recordAt(parent: Json, key: string): Json {
  const found = parent[key]
  if (isRecord(found)) return found
  const made: Json = {}
  parent[key] = made
  return made
}

/** The image, command, arguments, resource limits and port a call gives, set on a container; what it leaves out stays. */
function applyContainer(container: Json, args: RunDeployArgs): void {
  container.image = args.image
  if (args.command !== undefined) container.command = args.command
  if (args.args !== undefined) container.args = args.args
  if (args.cpu !== undefined || args.memory !== undefined) {
    const limits = recordAt(recordAt(container, "resources"), "limits")
    if (args.cpu !== undefined) limits.cpu = args.cpu
    if (args.memory !== undefined) limits.memory = args.memory
  }
  if (args.port !== undefined) {
    const [first] = Array.isArray(container.ports) ? (container.ports as unknown[]) : []
    const name = isRecord(first) && typeof first.name === "string" && first.name !== "" ? first.name : undefined
    container.ports = [{ ...(name !== undefined && { name }), containerPort: args.port }]
  }
}

/** The scaling, timeout and concurrency a call gives, set on a template; the scaling keys it leaves out stay. */
function applyTemplate(template: Json, args: RunDeployArgs): void {
  if (args.min_instances !== undefined || args.max_instances !== undefined) {
    const scaling = recordAt(template, "scaling")
    if (args.min_instances !== undefined) scaling.minInstanceCount = args.min_instances
    if (args.max_instances !== undefined) scaling.maxInstanceCount = args.max_instances
  }
  if (args.timeout_seconds !== undefined) template.timeout = timeoutText(args.timeout_seconds)
  if (args.concurrency !== undefined) template.maxInstanceRequestConcurrency = args.concurrency
}

/** The template of a new service: one container holding what the call gives, and nothing else, so Google's defaults apply. A variable to remove is refused, since there is nothing to remove from. */
export function newTemplate(args: RunDeployArgs): Json {
  const entries = Object.entries(args.env ?? {})
  const removed = entries.find(([, value]) => value === null)
  if (removed !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `\`${removed[0]}\` is to be removed, but the service does not exist yet, so it has no variables; nothing was changed.`,
    )
  }
  const container: Json = {}
  if (args.container !== undefined) container.name = args.container
  applyContainer(container, args)
  if (entries.length > 0) container.env = entries.map(([name, value]) => ({ name, value }))
  const template: Json = { containers: [container] }
  applyTemplate(template, args)
  return template
}

/** The index of the container a call changes among `names`, or `invalid_argument` when the call does not tell which. */
function chosenIndex(names: readonly string[], chosen: string | undefined): number {
  const listed = names.map((name) => JSON.stringify(name)).join(", ")
  if (chosen === undefined) {
    if (names.length > 1) {
      throw new ToolError(
        "invalid_argument",
        `The service has ${names.length} containers (${listed}); name the one to change in \`container\`.`,
      )
    }
    return 0
  }
  const index = names.indexOf(chosen)
  if (index === -1) {
    throw new ToolError(
      "invalid_argument",
      `The service has no container named ${shown(chosen)}; its containers are ${listed}.`,
    )
  }
  return index
}

/** Sets, replaces and removes plain variables of a container; a variable that references a secret is refused, and so is the removal of one that is not there. */
function applyEnv(container: Json, changes: Record<string, string | null>): void {
  const env = Array.isArray(container.env) ? [...(container.env as unknown[])] : []
  for (const [name, value] of Object.entries(changes)) {
    const at = env.findIndex((entry) => isRecord(entry) && entry.name === name)
    const existing = env[at]
    if (isRecord(existing) && existing.valueSource !== undefined) {
      throw new ToolError(
        "invalid_argument",
        `\`${name}\` references a secret, which these tools never set or remove; nothing was changed.`,
      )
    }
    if (value === null) {
      if (at === -1) {
        throw new ToolError(
          "invalid_argument",
          `\`${name}\` is not a variable of the container, so there is nothing to remove; nothing was changed.`,
        )
      }
      env.splice(at, 1)
    } else if (at === -1) {
      env.push({ name, value })
    } else {
      env[at] = { ...(existing as Json), value }
    }
  }
  container.env = env
}

/**
 * The template of an existing service with the call's changes, and the index
 * of the container changed. It is a copy of Google's own `template`, so every
 * field the call does not change, unknown ones included, is sent back as it
 * was; only `revision` is dropped, since a fixed name would clash with the new
 * revision. A template that holds a value the client masked (shaped like a
 * Google credential) is refused: sending it back would replace the value with
 * the mask.
 */
export function updatedTemplate(current: unknown, args: RunDeployArgs): { template: Json; index: number } {
  const template = structuredClone(isRecord(current) ? current : {})
  delete template.revision
  if (JSON.stringify(template).includes(MASK)) {
    throw new ToolError(
      "invalid_argument",
      "The service's settings hold a value shaped like a Google credential, which these tools cannot read back whole, so a deploy would replace it with a mask; nothing was changed.",
    )
  }
  const containers = template.containers
  if (!Array.isArray(containers) || containers.length === 0 || !containers.every(isRecord)) {
    throw new ToolError("upstream_error", "The service has no container to change.")
  }
  const names = containers.map((container) => (typeof container.name === "string" ? container.name : ""))
  const index = chosenIndex(names, args.container)
  const container = containers[index] as Json
  applyContainer(container, args)
  if (args.env !== undefined) applyEnv(container, args.env)
  applyTemplate(template, args)
  return { template, index }
}
