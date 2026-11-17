import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { operationOutput, projectArg, regionArg } from "./change-args"
import { serviceSchema, WHOLE_PERCENT } from "./service-view"

/** The most entries a traffic split has. */
export const MAX_TRAFFIC_ENTRIES = 20

/** A traffic tag: lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen. */
const TAG_PATTERN = /^[a-z](?:[a-z0-9-]{0,44}[a-z0-9])?$/

const trafficEntry = z.strictObject({
  revision: z
    .string()
    .optional()
    .describe(
      "The short name of the revision that takes this share, as `google_run_read` revisions lists it. Give this or `latest`, not both.",
    ),
  latest: z
    .literal(true)
    .optional()
    .describe(
      "`true` for the share that follows the service's latest ready revision. Give this or `revision`, not both.",
    ),
  percent: z.number().int().min(0).max(WHOLE_PERCENT).describe("The share of requests, 0 to 100."),
  tag: z
    .string()
    .regex(TAG_PATTERN)
    .optional()
    .describe("A tag that gives this target its own URL: lowercase letters, digits and hyphens, up to 46 characters."),
})

export const runTrafficInput = z.strictObject({
  account: accountArg,
  project: projectArg,
  region: regionArg,
  service: z.string().describe("The service's short name, as `google_run_read` lists it."),
  traffic: z
    .array(trafficEntry)
    .min(1)
    .max(MAX_TRAFFIC_ENTRIES)
    .describe(
      `The whole traffic split, replacing the one the service has (1 to ${MAX_TRAFFIC_ENTRIES} entries): each names one revision or \`latest\`, once at most; the percents add up to exactly 100; a tag is used once at most. Tags and revisions left out are dropped from the split.`,
    ),
})

export const runTrafficOutput = z.object({
  service: serviceSchema
    .nullable()
    .describe("The service as Google reports it once the change is done; null while the operation is still running."),
  before: z
    .object({
      traffic: serviceSchema.shape.traffic.describe("The split the service had set."),
      traffic_statuses: serviceSchema.shape.traffic_statuses.describe("The traffic the service served."),
    })
    .describe("What the traffic was before the change."),
  operation: operationOutput,
})

export type RunTrafficArgs = z.output<typeof runTrafficInput>
export type RunTrafficResult = z.input<typeof runTrafficOutput>
