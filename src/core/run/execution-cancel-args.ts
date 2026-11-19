import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { executionSchema } from "./execution-view"

export const runExecutionCancelInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  job: z.string().describe("The short name of the job the execution belongs to."),
  execution: z.string().describe("The execution's short name, as `google_run_read` method `executions` lists it."),
})

export const runExecutionCancelOutput = z.object({
  execution: executionSchema
    .nullable()
    .describe("The execution as Google reports it once the cancel is done; null while the operation is still running."),
  operation: operationOutput,
})

export type RunExecutionCancelArgs = z.output<typeof runExecutionCancelInput>
export type RunExecutionCancelResult = z.input<typeof runExecutionCancelOutput>
