import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { MAX_COMMAND_ITEMS, MAX_ENV_ENTRIES, MAX_ENV_VALUE_LENGTH, commandItems, envRecord } from "./container-args"
import { executionSchema } from "./execution-view"
import { MAX_JOB_TIMEOUT_SECONDS, MAX_TASKS } from "./job-deploy-args"

export const runJobRunInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  job: z.string().describe("The job's short name."),
  container: z
    .string()
    .optional()
    .describe(
      "The name of the container whose `env` or `args` are overridden. Needed when the job has more than one container and `env` or `args` are given, and refused when it names none of them.",
    ),
  env: envRecord(z.string().max(MAX_ENV_VALUE_LENGTH))
    .optional()
    .describe(
      `Environment variables to set for this execution only, by name (at most ${MAX_ENV_ENTRIES}), each a plain value (up to ${MAX_ENV_VALUE_LENGTH} characters). They are merged with the container's own; the job is not changed. A variable that references a secret is refused.`,
    ),
  args: commandItems
    .optional()
    .describe(
      `The container's arguments for this execution only, replacing the job's (up to ${MAX_COMMAND_ITEMS} items); \`[]\` clears them for this run. The job is not changed. Left out, the job's own apply.`,
    ),
  task_count: z
    .number()
    .int()
    .min(1)
    .max(MAX_TASKS)
    .optional()
    .describe(
      `The number of tasks this execution runs (1 to ${MAX_TASKS}), for this execution only; the job is not changed. Left out, the job's own applies.`,
    ),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_JOB_TIMEOUT_SECONDS)
    .optional()
    .describe(
      `How long one task may run, in seconds (1 to ${MAX_JOB_TIMEOUT_SECONDS}), for this execution only; the job is not changed. Left out, the job's own applies.`,
    ),
})

export const runJobRunOutput = z.object({
  execution: executionSchema
    .nullable()
    .describe(
      "The execution Google started, as the operation reports it right away (null when the reply held none); it is still running. Follow it with `google_run_read` method `execution`.",
    ),
  operation: operationOutput,
})

export type RunJobRunArgs = z.output<typeof runJobRunInput>
export type RunJobRunResult = z.input<typeof runJobRunOutput>
