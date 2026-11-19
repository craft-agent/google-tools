import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { deletedOutput, operationOutput, projectArg, regionArg } from "./change-args"

export const runRevisionDeleteInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  service: z.string().describe("The short name of the service the revision belongs to."),
  revision: z.string().describe("The revision's short name, as `google_run_read` method `revisions` lists it."),
})

export const runRevisionDeleteOutput = z.object({
  revision: z.string().describe("The revision's short name."),
  deleted: deletedOutput,
  operation: operationOutput,
})

export type RunRevisionDeleteArgs = z.output<typeof runRevisionDeleteInput>
export type RunRevisionDeleteResult = z.input<typeof runRevisionDeleteOutput>
