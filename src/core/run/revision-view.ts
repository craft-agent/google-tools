import { z } from "zod"
import { shortName, shortNameOrNull } from "./names"
import { generationReply, generationText, instanceCountsReply } from "./shared-view"
import { conditionSchema, conditionsReply, conditionViews, readyStatus, statusSchema } from "./status-view"
import { templateSettings, templateSettingsReply, templateSettingsShape } from "./template-view"

/** A revision as Google gives it; the annotations and every field not read here are left out of the parse. */
export const revisionReply = templateSettingsReply.extend({
  name: z.string().optional(),
  service: z.string().optional(),
  generation: generationReply,
  createTime: z.string().optional(),
  logUri: z.string().optional(),
  maxInstanceRequestConcurrency: z.number().optional(),
  scaling: instanceCountsReply,
  conditions: conditionsReply,
  containerStatuses: z.array(z.object({ name: z.string().optional(), imageDigest: z.string().optional() })).optional(),
})

export const revisionSummarySchema = z.object({
  revision: z.string(),
  create_time: z.string().nullable(),
  ready: statusSchema,
  images: z.array(z.object({ image: z.string(), digest: z.string().nullable() })),
  log_uri: z.string().nullable(),
})

export const revisionSchema = revisionSummarySchema.extend({
  service: z.string().nullable(),
  generation: z.string().nullable(),
  concurrency: z.number().nullable(),
  min_instances: z.number().nullable(),
  max_instances: z.number().nullable(),
  conditions: z.array(conditionSchema),
  ...templateSettingsShape,
})

export type RevisionReply = z.infer<typeof revisionReply>
export type RevisionSummary = z.infer<typeof revisionSummarySchema>
export type RevisionView = z.infer<typeof revisionSchema>

/** Each container's image with the digest Google resolved it to, matched by container name and else by position. */
function imagesOf(reply: RevisionReply): RevisionSummary["images"] {
  const statuses = reply.containerStatuses ?? []
  return (reply.containers ?? []).map((container, index) => {
    const status = statuses.find((candidate) => container.name !== undefined && candidate.name === container.name)
    return { image: container.image ?? "", digest: (status ?? statuses[index])?.imageDigest ?? null }
  })
}

/** A revision for a list: its name, age, readiness and images. */
export function revisionSummary(reply: RevisionReply): RevisionSummary {
  return {
    revision: shortName(reply.name),
    create_time: reply.createTime ?? null,
    ready: readyStatus(reply.conditions),
    images: imagesOf(reply),
    log_uri: reply.logUri ?? null,
  }
}

/** A revision in full: its scaling, conditions and settings, with no environment value and no annotation. */
export function revisionView(reply: RevisionReply): RevisionView {
  return {
    ...revisionSummary(reply),
    service: shortNameOrNull(reply.service),
    generation: generationText(reply.generation),
    concurrency: reply.maxInstanceRequestConcurrency ?? null,
    min_instances: reply.scaling?.minInstanceCount ?? null,
    max_instances: reply.scaling?.maxInstanceCount ?? null,
    conditions: conditionViews(reply.conditions),
    ...templateSettings(reply),
  }
}
