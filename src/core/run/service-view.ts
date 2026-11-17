import { z } from "zod"
import { shortName, shortNameOrNull } from "./names"
import { generationReply, generationText, instanceCountsReply } from "./shared-view"
import {
  conditionReply,
  conditionSchema,
  conditionsReply,
  conditionViews,
  statusSchema,
  statusView,
} from "./status-view"
import { templateSettings, templateSettingsReply, templateSettingsShape } from "./template-view"

/** How Google names the traffic allocation that follows the latest revision. */
export const LATEST_ALLOCATION = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"

/** How Google names the traffic allocation that goes to one named revision. */
export const REVISION_ALLOCATION = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION"

/** The percents of a traffic split add up to this. */
export const WHOLE_PERCENT = 100

const INGRESS_NAMES = {
  INGRESS_TRAFFIC_ALL: "all",
  INGRESS_TRAFFIC_INTERNAL_ONLY: "internal",
  INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER: "internal_load_balancer",
  INGRESS_TRAFFIC_NONE: "none",
} as const

const SCALING_MODES = { AUTOMATIC: "automatic", MANUAL: "manual" } as const

const trafficReply = z.object({
  type: z.string().optional(),
  revision: z.string().optional(),
  percent: z.number().optional(),
  tag: z.string().optional(),
  uri: z.string().optional(),
})

/** A service as Google gives it; the annotations and every field not read here are left out of the parse. */
export const serviceReply = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  uri: z.string().optional(),
  urls: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  generation: generationReply,
  createTime: z.string().optional(),
  updateTime: z.string().optional(),
  creator: z.string().optional(),
  lastModifier: z.string().optional(),
  launchStage: z.string().optional(),
  ingress: z.string().optional(),
  invokerIamDisabled: z.boolean().optional(),
  defaultUriDisabled: z.boolean().optional(),
  iapEnabled: z.boolean().optional(),
  customAudiences: z.array(z.string()).optional(),
  reconciling: z.boolean().optional(),
  terminalCondition: conditionReply.optional(),
  conditions: conditionsReply,
  latestReadyRevision: z.string().optional(),
  latestCreatedRevision: z.string().optional(),
  traffic: z.array(trafficReply).optional(),
  trafficStatuses: z.array(trafficReply).optional(),
  scaling: z
    .object({
      minInstanceCount: z.number().optional(),
      maxInstanceCount: z.number().optional(),
      scalingMode: z.string().optional(),
      manualInstanceCount: z.number().optional(),
    })
    .optional(),
  template: templateSettingsReply
    .extend({
      revision: z.string().optional(),
      maxInstanceRequestConcurrency: z.number().optional(),
      sessionAffinity: z.boolean().optional(),
      scaling: instanceCountsReply,
    })
    .optional(),
})

const trafficShape = {
  type: z.enum(["latest", "revision"]),
  revision: z.string().nullable(),
  percent: z.number(),
  tag: z.string().nullable(),
}

export const serviceSummarySchema = z.object({
  service: z.string(),
  uri: z.string().nullable(),
  ready: statusSchema,
  latest_ready_revision: z.string().nullable(),
  latest_created_revision: z.string().nullable(),
  update_time: z.string().nullable(),
  last_modifier: z.string().nullable(),
})

export const serviceSchema = serviceSummarySchema.extend({
  description: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  urls: z.array(z.string()),
  ingress: z.enum(INGRESS_NAMES).nullable(),
  invoker_iam_disabled: z.boolean(),
  default_uri_disabled: z.boolean(),
  iap_enabled: z.boolean(),
  custom_audiences: z.array(z.string()),
  generation: z.string().nullable(),
  reconciling: z.boolean(),
  create_time: z.string().nullable(),
  creator: z.string().nullable(),
  launch_stage: z.string().nullable(),
  conditions: z.array(conditionSchema),
  traffic: z.array(z.object(trafficShape)),
  traffic_statuses: z.array(z.object({ ...trafficShape, uri: z.string().nullable() })),
  scaling: z.object({
    min_instances: z.number().nullable(),
    max_instances: z.number().nullable(),
    mode: z.enum(SCALING_MODES).nullable(),
    manual_instances: z.number().nullable(),
  }),
  template: z.object({
    revision: z.string().nullable(),
    concurrency: z.number().nullable(),
    session_affinity: z.boolean(),
    min_instances: z.number().nullable(),
    max_instances: z.number().nullable(),
    ...templateSettingsShape,
  }),
})

export type ServiceReply = z.infer<typeof serviceReply>
export type ServiceSummary = z.infer<typeof serviceSummarySchema>
export type ServiceView = z.infer<typeof serviceSchema>

type TrafficReply = z.infer<typeof trafficReply>

function trafficView(target: TrafficReply) {
  return {
    type: target.type === LATEST_ALLOCATION ? ("latest" as const) : ("revision" as const),
    revision: target.revision ?? null,
    percent: target.percent ?? 0,
    tag: target.tag ?? null,
  }
}

/** A service for a list: its name, URL, readiness and latest revisions. */
export function serviceSummary(reply: ServiceReply): ServiceSummary {
  return {
    service: shortName(reply.name),
    uri: reply.uri ?? null,
    ready: statusView(reply.terminalCondition),
    latest_ready_revision: shortNameOrNull(reply.latestReadyRevision),
    latest_created_revision: shortNameOrNull(reply.latestCreatedRevision),
    update_time: reply.updateTime ?? null,
    last_modifier: reply.lastModifier ?? null,
  }
}

/** A service in full: traffic as set and as served, scaling and its template, with no environment value and no annotation. */
export function serviceView(reply: ServiceReply): ServiceView {
  const { scaling } = reply
  const template: NonNullable<ServiceReply["template"]> = reply.template ?? {}
  const mode = scaling?.scalingMode
  return {
    ...serviceSummary(reply),
    description: reply.description ?? null,
    labels: reply.labels ?? {},
    urls: reply.urls ?? [],
    ingress:
      reply.ingress !== undefined && Object.hasOwn(INGRESS_NAMES, reply.ingress)
        ? INGRESS_NAMES[reply.ingress as keyof typeof INGRESS_NAMES]
        : null,
    invoker_iam_disabled: reply.invokerIamDisabled ?? false,
    default_uri_disabled: reply.defaultUriDisabled ?? false,
    iap_enabled: reply.iapEnabled ?? false,
    custom_audiences: reply.customAudiences ?? [],
    generation: generationText(reply.generation),
    reconciling: reply.reconciling ?? false,
    create_time: reply.createTime ?? null,
    creator: reply.creator ?? null,
    launch_stage: reply.launchStage ?? null,
    conditions: conditionViews(reply.conditions),
    traffic: (reply.traffic ?? []).map(trafficView),
    traffic_statuses: (reply.trafficStatuses ?? []).map((target) => ({
      ...trafficView(target),
      uri: target.uri ?? null,
    })),
    scaling: {
      min_instances: scaling?.minInstanceCount ?? null,
      max_instances: scaling?.maxInstanceCount ?? null,
      mode:
        mode !== undefined && Object.hasOwn(SCALING_MODES, mode)
          ? SCALING_MODES[mode as keyof typeof SCALING_MODES]
          : null,
      manual_instances: scaling?.manualInstanceCount ?? null,
    },
    template: {
      revision: template.revision ?? null,
      concurrency: template.maxInstanceRequestConcurrency ?? null,
      session_affinity: template.sessionAffinity ?? false,
      min_instances: template.scaling?.minInstanceCount ?? null,
      max_instances: template.scaling?.maxInstanceCount ?? null,
      ...templateSettings(template),
    },
  }
}
