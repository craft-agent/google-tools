import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { argsArg, commandArg, containerArg, cpuArg, envArg, imageArg, memoryArg } from "./container-args"
import { serviceSchema } from "./service-view"

/** The most instances a service keeps, the longest request timeout in seconds, the most requests an instance takes at once and the highest port. */
export const MAX_INSTANCES = 1000
export const MAX_TIMEOUT_SECONDS = 3600
export const MAX_CONCURRENCY = 1000
const MAX_PORT = 65_535

export const runDeployInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  service: z.string().describe("The service's short name. A service that does not exist yet is created."),
  image: imageArg,
  container: containerArg("service"),
  env: envArg,
  command: commandArg,
  args: argsArg,
  cpu: cpuArg,
  memory: memoryArg,
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
