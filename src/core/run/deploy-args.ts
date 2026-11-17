import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { serviceSchema } from "./service-view"

/** The most environment variables one call sets or removes, the longest value of one and the pattern of a name. */
export const MAX_ENV_ENTRIES = 50
export const MAX_ENV_VALUE_LENGTH = 32_768
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/

/** The most items of a container's `command` and of its `args`. */
export const MAX_COMMAND_ITEMS = 100

/** A CPU limit such as `1`, `0.5` or `500m`, and a memory limit such as `512Mi` or `2Gi`. */
const CPU_PATTERN = /^(?:[0-9]+m|[0-9]+(?:\.[0-9]+)?)$/
const MEMORY_PATTERN = /^[0-9]+(?:Mi|Gi|M|G)$/

/** The most instances a service keeps, the longest request timeout in seconds, the most requests an instance takes at once and the highest port. */
export const MAX_INSTANCES = 1000
export const MAX_TIMEOUT_SECONDS = 3600
export const MAX_CONCURRENCY = 1000
const MAX_PORT = 65_535

const commandItems = z.array(z.string()).max(MAX_COMMAND_ITEMS)

export const runDeployInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  service: z.string().describe("The service's short name. A service that does not exist yet is created."),
  image: z
    .string()
    .describe(
      "The container image to deploy, from the project's own registry: `<location>-docker.pkg.dev/<project>/<repository>/<image>`, `gcr.io/<project>/<image>` or `<us|eu|asia>.gcr.io/<project>/<image>`, with an optional `:<tag>` or `@sha256:<digest>`. Any other registry is refused.",
    ),
  container: z
    .string()
    .optional()
    .describe(
      "The name of the container to change. Needed when the service has more than one container, and refused when it names none of them. Left out, the service's only container is changed; on a new service it names the container.",
    ),
  env: z
    .record(z.string().regex(ENV_NAME_PATTERN), z.string().max(MAX_ENV_VALUE_LENGTH).nullable())
    .refine((env) => Object.keys(env).length <= MAX_ENV_ENTRIES, `Give at most ${MAX_ENV_ENTRIES} variables.`)
    .optional()
    .describe(
      `Environment variables to change, by name (at most ${MAX_ENV_ENTRIES}): a string sets a plain value (up to ${MAX_ENV_VALUE_LENGTH} characters), \`null\` removes the variable. A variable that references a secret is refused, set or removed. Variables left out keep their values.`,
    ),
  command: commandItems
    .optional()
    .describe(
      `The container's entrypoint, replacing it (up to ${MAX_COMMAND_ITEMS} items); \`[]\` clears it so the image's own applies. Left out, it keeps its value.`,
    ),
  args: commandItems
    .optional()
    .describe(
      `The container's arguments, replacing them (up to ${MAX_COMMAND_ITEMS} items); \`[]\` clears them so the image's own apply. Left out, they keep their value.`,
    ),
  cpu: z
    .string()
    .regex(CPU_PATTERN)
    .optional()
    .describe("The container's CPU limit, such as `1`, `0.5` or `500m`. Left out, it keeps its value."),
  memory: z
    .string()
    .regex(MEMORY_PATTERN)
    .optional()
    .describe("The container's memory limit, such as `512Mi` or `2Gi`. Left out, it keeps its value."),
  min_instances: z
    .number()
    .int()
    .min(0)
    .max(MAX_INSTANCES)
    .optional()
    .describe(
      `The fewest instances kept running (0 to ${MAX_INSTANCES}, at most \`max_instances\`). Left out, it keeps its value.`,
    ),
  max_instances: z
    .number()
    .int()
    .min(0)
    .max(MAX_INSTANCES)
    .optional()
    .describe(`The most instances (0 to ${MAX_INSTANCES}). Left out, it keeps its value.`),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_SECONDS)
    .optional()
    .describe(`The request timeout in seconds (1 to ${MAX_TIMEOUT_SECONDS}). Left out, it keeps its value.`),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(MAX_CONCURRENCY)
    .optional()
    .describe(`The most requests one instance takes at once (1 to ${MAX_CONCURRENCY}). Left out, it keeps its value.`),
  port: z
    .number()
    .int()
    .min(1)
    .max(MAX_PORT)
    .optional()
    .describe("The port the container listens on (1 to 65535). Left out, it keeps its value."),
})

export const runDeployOutput = z.object({
  created: z.boolean().describe("True when the service did not exist and was created."),
  service: serviceSchema
    .nullable()
    .describe("The service as Google reports it once the change is done; null while the operation is still running."),
  revision: z
    .string()
    .nullable()
    .describe("The short name of the revision the deploy created; null while the operation is still running."),
  before: z
    .object({
      image: z.string().describe("The image the changed container ran."),
      template: serviceSchema.shape.template.describe("The service's template before the deploy."),
    })
    .nullable()
    .describe("What the service was before, with no environment value; null when the service was created."),
  operation: operationOutput,
})

export type RunDeployArgs = z.output<typeof runDeployInput>
export type RunDeployResult = z.input<typeof runDeployOutput>
