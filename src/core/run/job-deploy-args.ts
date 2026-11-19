import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { argsArg, commandArg, containerArg, cpuArg, envArg, imageArg, memoryArg } from "./container-args"
import { jobSchema } from "./job-view"

/** The longest task timeout in seconds, the most tasks an execution runs or runs at once, and the most retries of a task. */
export const MAX_JOB_TIMEOUT_SECONDS = 604_800
export const MAX_TASKS = 10_000
const MAX_RETRIES = 10

export const runJobDeployInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  job: z.string().describe("The job's short name. A job that does not exist yet is created."),
  image: imageArg,
  container: containerArg("job"),
  env: envArg,
  command: commandArg,
  args: argsArg,
  cpu: cpuArg,
  memory: memoryArg,
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_JOB_TIMEOUT_SECONDS)
    .optional()
    .describe(`How long one task may run, in seconds (1 to ${MAX_JOB_TIMEOUT_SECONDS}). Left out, it keeps its value.`),
  task_count: z
    .number()
    .int()
    .min(1)
    .max(MAX_TASKS)
    .optional()
    .describe(`The number of tasks each execution runs (1 to ${MAX_TASKS}). Left out, it keeps its value.`),
  parallelism: z
    .number()
    .int()
    .min(1)
    .max(MAX_TASKS)
    .optional()
    .describe(
      `The most tasks that run at once (1 to ${MAX_TASKS}, at most \`task_count\` when both are given). Left out, it keeps its value.`,
    ),
  max_retries: z
    .number()
    .int()
    .min(0)
    .max(MAX_RETRIES)
    .optional()
    .describe(
      `How many times a failed task is retried before it counts as failed (0 to ${MAX_RETRIES}). Left out, it keeps its value.`,
    ),
})

export const runJobDeployOutput = z.object({
  created: z.boolean().describe("True when the job did not exist and was created."),
  job: jobSchema
    .nullable()
    .describe("The job as Google reports it once the change is done; null while the operation is still running."),
  before: z
    .object({
      image: z.string().describe("The image the changed container ran."),
      template: jobSchema.shape.template.describe("The job's task template before the deploy."),
    })
    .nullable()
    .describe("What the job was before, with no environment value; null when the job was created."),
  operation: operationOutput,
})

export type RunJobDeployArgs = z.output<typeof runJobDeployInput>
export type RunJobDeployResult = z.input<typeof runJobDeployOutput>
