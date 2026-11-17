import { z } from "zod"

/** The `project` argument of the Cloud Run tools that write. */
export const projectArg = z
  .string()
  .describe("The Google Cloud project's id (not its number or name); there is no default.")

/** The `region` argument of the Cloud Run tools that write. */
export const regionArg = z.string().describe("The Cloud Run region, such as `asia-northeast1`; there is no default.")

/** The operation a write started: its id, for `google_run_read` method `operation`, and whether it had finished when the call returned. */
export const operationOutput = z.object({
  operation: z.string().describe("The operation's id, which `google_run_read` method `operation` follows."),
  done: z.boolean().describe("False when the change was still running at the deadline, so its result is not known."),
})
