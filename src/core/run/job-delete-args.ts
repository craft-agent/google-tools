import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { deletedOutput, operationOutput, projectArg, regionArg } from "./change-args"

export const runJobDeleteInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  job: z.string().describe("The job's short name, as `google_run_read` method `jobs` lists it."),
})

export const runJobDeleteOutput = z.object({
  job: z.string().describe("The job's short name."),
  deleted: deletedOutput,
  operation: operationOutput,
})

export type RunJobDeleteArgs = z.output<typeof runJobDeleteInput>
export type RunJobDeleteResult = z.input<typeof runJobDeleteOutput>
