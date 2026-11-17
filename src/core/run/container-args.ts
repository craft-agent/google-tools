import { z } from "zod"

/** The most environment variables one call sets or removes, the longest value of one and the pattern of a name. */
export const MAX_ENV_ENTRIES = 50
export const MAX_ENV_VALUE_LENGTH = 32_768
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/

/** The most items of a container's `command` and of its `args`. */
export const MAX_COMMAND_ITEMS = 100

/** A CPU limit such as `1`, `0.5` or `500m`, and a memory limit such as `512Mi` or `2Gi`. */
const CPU_PATTERN = /^(?:[0-9]+m|[0-9]+(?:\.[0-9]+)?)$/
const MEMORY_PATTERN = /^[0-9]+(?:Mi|Gi|M|G)$/

/** A list of command or argument items. */
export const commandItems = z.array(z.string()).max(MAX_COMMAND_ITEMS)

/** Environment variables by name, each with a value of `value`, at most `MAX_ENV_ENTRIES` of them. */
export function envRecord<Value extends z.ZodType>(value: Value) {
  return z
    .record(z.string().regex(ENV_NAME_PATTERN), value)
    .refine((env) => Object.keys(env).length <= MAX_ENV_ENTRIES, `Give at most ${MAX_ENV_ENTRIES} variables.`)
}

/** The `image` argument of a deploy, which `imageRepository` checks against the project's own registry. */
export const imageArg = z
  .string()
  .describe(
    "The container image to deploy, from the project's own registry: `<location>-docker.pkg.dev/<project>/<repository>/<image>`, `gcr.io/<project>/<image>` or `<us|eu|asia>.gcr.io/<project>/<image>`, with an optional `:<tag>` or `@sha256:<digest>`. Any other registry is refused.",
  )

/** The `container` argument of a deploy of a `subject` (`service` or `job`). */
export const containerArg = (subject: string) =>
  z
    .string()
    .optional()
    .describe(
      `The name of the container to change. Needed when the ${subject} has more than one container, and refused when it names none of them. Left out, the ${subject}'s only container is changed; on a new ${subject} it names the container.`,
    )

export const envArg = envRecord(z.string().max(MAX_ENV_VALUE_LENGTH).nullable())
  .optional()
  .describe(
    `Environment variables to change, by name (at most ${MAX_ENV_ENTRIES}): a string sets a plain value (up to ${MAX_ENV_VALUE_LENGTH} characters), \`null\` removes the variable. A variable that references a secret is refused, set or removed. Variables left out keep their values.`,
  )

export const commandArg = commandItems
  .optional()
  .describe(
    `The container's entrypoint, replacing it (up to ${MAX_COMMAND_ITEMS} items); \`[]\` clears it so the image's own applies. Left out, it keeps its value.`,
  )

export const argsArg = commandItems
  .optional()
  .describe(
    `The container's arguments, replacing them (up to ${MAX_COMMAND_ITEMS} items); \`[]\` clears them so the image's own apply. Left out, they keep their value.`,
  )

export const cpuArg = z
  .string()
  .regex(CPU_PATTERN)
  .optional()
  .describe("The container's CPU limit, such as `1`, `0.5` or `500m`. Left out, it keeps its value.")

export const memoryArg = z
  .string()
  .regex(MEMORY_PATTERN)
  .optional()
  .describe("The container's memory limit, such as `512Mi` or `2Gi`. Left out, it keeps its value.")
