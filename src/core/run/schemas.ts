import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { bindingSchema, operationSchema } from "./access-view"
import { executionSchema, executionSummarySchema, taskSchema } from "./execution-view"
import { jobSchema, jobSummarySchema } from "./job-view"
import { revisionSchema, revisionSummarySchema } from "./revision-view"
import { serviceSchema, serviceSummarySchema } from "./service-view"

/** The methods of the Cloud Run read. */
export const RUN_METHODS = [
  "services",
  "service",
  "revisions",
  "revision",
  "jobs",
  "job",
  "executions",
  "execution",
  "tasks",
  "iam",
  "operation",
] as const

/** What a list returns when `limit` is left out, and the most it returns. */
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

export const runReadInput = z.strictObject({
  method: z.enum(RUN_METHODS),
  account: accountArg,
  project: z.string().describe("Every method: the Google Cloud project's id (not its number or name)."),
  region: z.string().describe("Every method: the Cloud Run region, such as `asia-northeast1`."),
  service: z
    .string()
    .optional()
    .describe(
      "service, revisions, revision: the service's short name; iam: the service whose policy to read (never with `job`).",
    ),
  revision: z.string().optional().describe("revision: the revision's short name, as `revisions` lists it."),
  job: z
    .string()
    .optional()
    .describe(
      "job, executions, execution, tasks: the job's short name; iam: the job whose policy to read (never with `service`).",
    ),
  execution: z.string().optional().describe("execution, tasks: the execution's short name, as `executions` lists it."),
  operation: z
    .string()
    .optional()
    .describe("operation: the operation's id, the last part of its name, as a write tool returned it."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `services, revisions, jobs, executions, tasks: how many to return (1 to ${MAX_LIMIT}; default ${DEFAULT_LIMIT}).`,
    ),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe(
      "services, revisions, jobs, executions, tasks: the `next_page_token` of the previous call, for the next page.",
    ),
})

/** The keys of every view a method returns; where methods share a key, the schema takes what each gives. */
const keysOf = {
  ...serviceSchema.shape,
  ...revisionSchema.shape,
  ...jobSchema.shape,
  ...executionSchema.shape,
  ...taskSchema.shape,
  /** A service's, a job's or an execution's template; a revision has its settings in the result itself. */
  template: z.union([serviceSchema.shape.template, jobSchema.shape.template, executionSchema.shape.template]),
  bindings: z.array(bindingSchema),
  /** Whether `allUsers` or `allAuthenticatedUsers` is a member of a binding. */
  public: z.boolean(),
  ...operationSchema.shape,
}

const listOutput = {
  services: z.array(serviceSummarySchema),
  revisions: z.array(revisionSummarySchema),
  jobs: z.array(jobSummarySchema),
  executions: z.array(executionSummarySchema),
  tasks: z.array(taskSchema),
  next_page_token: z.string().nullable(),
}

/** One object for all methods, each filling its own keys; a list fills one list key and `next_page_token`. */
export const runReadOutput = z.object({ ...keysOf, ...listOutput }).partial()

export type RunReadArgs = z.output<typeof runReadInput>
export type RunMethod = (typeof RUN_METHODS)[number]
export type RunReadResult = z.input<typeof runReadOutput>
