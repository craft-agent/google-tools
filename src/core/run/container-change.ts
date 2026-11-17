import { isRecord } from "../describe"
import { ToolError } from "../errors"
import { MASK } from "../google/mask"
import { shown } from "./ids"

/** A JSON object of Google's, which a deploy copies and changes in place. */
export type Json = Record<string, unknown>

/** What a call changes on a container, as a service deploy and a job deploy both give it. */
export type ContainerArgs = {
  image: string
  container?: string
  env?: Record<string, string | null>
  command?: string[]
  args?: string[]
  cpu?: string
  memory?: string
  port?: number
}

/** The member `key` of `parent` as an object, made when it is missing. */
export function recordAt(parent: Json, key: string): Json {
  const found = parent[key]
  if (isRecord(found)) return found
  const made: Json = {}
  parent[key] = made
  return made
}

/** The image, command, arguments, resource limits and port a call gives, set on a container; what it leaves out stays. */
export function applyContainer(container: Json, args: ContainerArgs): void {
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

/** The refusal of a variable that references a secret, which these tools never set, remove or override. */
export function secretRefusal(name: string): ToolError {
  return new ToolError(
    "invalid_argument",
    `\`${name}\` references a secret, which these tools never set or remove; nothing was changed.`,
  )
}

/** The container of a `subject` (`service`, `job`) that does not exist yet: what the call gives and nothing else, so Google's defaults apply. A variable to remove is refused, since there is nothing to remove from. */
export function newContainer(args: ContainerArgs, subject: string): Json {
  const entries = Object.entries(args.env ?? {})
  const removed = entries.find(([, value]) => value === null)
  if (removed !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `\`${removed[0]}\` is to be removed, but the ${subject} does not exist yet, so it has no variables; nothing was changed.`,
    )
  }
  const container: Json = {}
  if (args.container !== undefined) container.name = args.container
  applyContainer(container, args)
  if (entries.length > 0) container.env = entries.map(([name, value]) => ({ name, value }))
  return container
}

/** The index of the container a call changes among `names`, or `invalid_argument` when the call does not tell which. */
export function chosenIndex(names: readonly string[], chosen: string | undefined, subject: string): number {
  const listed = names.map((name) => JSON.stringify(name)).join(", ")
  if (chosen === undefined) {
    if (names.length > 1) {
      throw new ToolError(
        "invalid_argument",
        `The ${subject} has ${names.length} containers (${listed}); name the one to change in \`container\`.`,
      )
    }
    return 0
  }
  const index = names.indexOf(chosen)
  if (index === -1) {
    throw new ToolError(
      "invalid_argument",
      `The ${subject} has no container named ${shown(chosen)}; its containers are ${listed}.`,
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
    if (isRecord(existing) && existing.valueSource !== undefined) throw secretRefusal(name)
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
 * Refuses a `copy` of a `subject` that holds a value the client masked (shaped
 * like a Google credential): sending it back would replace the value with the
 * mask.
 */
export function refuseMasked(copy: unknown, subject: string): void {
  if (JSON.stringify(copy).includes(MASK)) {
    throw new ToolError(
      "invalid_argument",
      `The ${subject}'s settings hold a value shaped like a Google credential, which these tools cannot read back whole, so a deploy would replace it with a mask; nothing was changed.`,
    )
  }
}

/**
 * Changes, in place, the one container of `template.containers` the call
 * names (the only one when it names none) and returns its index; any other
 * container and every field the call does not give stay as Google gave them.
 */
export function changeContainer(template: Json, args: ContainerArgs, subject: string): number {
  const containers = template.containers
  if (!Array.isArray(containers) || containers.length === 0 || !containers.every(isRecord)) {
    throw new ToolError("upstream_error", `The ${subject} has no container to change.`)
  }
  const names = containers.map((container) => (typeof container.name === "string" ? container.name : ""))
  const index = chosenIndex(names, args.container, subject)
  const container = containers[index] as Json
  applyContainer(container, args)
  if (args.env !== undefined) applyEnv(container, args.env)
  return index
}
