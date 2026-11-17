import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { deletedOutput, operationOutput, projectArg, regionArg } from "./change-args"

export const runServiceDeleteInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  service: z.string().describe("The service's short name, as `google_run_read` method `services` lists it."),
})

export const runServiceDeleteOutput = z.object({
  service: z.string().describe("The service's short name."),
  deleted: deletedOutput,
  operation: operationOutput,
})

export type RunServiceDeleteArgs = z.output<typeof runServiceDeleteInput>
export type RunServiceDeleteResult = z.input<typeof runServiceDeleteOutput>
