import { z } from "zod"
import { shortName } from "./names"
import { generationReply, generationText } from "./shared-view"
import {
  conditionReply,
  conditionSchema,
  conditionsReply,
  conditionViews,
  runStatusSchema,
  statusSchema,
  statusView,
  type RunStatus,
} from "./status-view"
import { templateSettings, templateSettingsReply, templateSettingsShape } from "./template-view"

/** What a job's latest execution reference says about how the execution ended, as Google names it. */
const COMPLETION_STATUSES: Readonly<Record<string, RunStatus>> = {
  EXECUTION_SUCCEEDED: "succeeded",
  EXECUTION_FAILED: "failed",
  EXECUTION_RUNNING: "running",
  EXECUTION_PENDING: "pending",
  EXECUTION_CANCELLED: "cancelled",
}

/** The task template of a job's execution template, which a job's executions and tasks share. */
export const taskTemplateReply = templateSettingsReply.extend({ maxRetries: z.number().optional() })

/** A job as Google gives it; the annotations and every field not read here are left out of the parse. */
export const jobReply = z.object({
  name: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  generation: generationReply,
  createTime: z.string().optional(),
  updateTime: z.string().optional(),
  creator: z.string().optional(),
  lastModifier: z.string().optional(),
  launchStage: z.string().optional(),
  reconciling: z.boolean().optional(),
  terminalCondition: conditionReply.optional(),
  conditions: conditionsReply,
  executionCount: z.number().optional(),
  latestCreatedExecution: z
    .object({
      name: z.string().optional(),
      createTime: z.string().optional(),
      completionTime: z.string().optional(),
      completionStatus: z.string().optional(),
    })
    .optional(),
  template: z
    .object({
      taskCount: z.number().optional(),
      parallelism: z.number().optional(),
      template: taskTemplateReply.optional(),
    })
    .optional(),
})

export const taskTemplateShape = {
  max_retries: z.number().nullable(),
  ...templateSettingsShape,
}

export const jobSummarySchema = z.object({
  job: z.string(),
  ready: statusSchema,
  update_time: z.string().nullable(),
  last_modifier: z.string().nullable(),
  execution_count: z.number(),
  latest_execution: z
    .object({
      execution: z.string(),
      status: runStatusSchema,
      create_time: z.string().nullable(),
      completion_time: z.string().nullable(),
    })
    .nullable(),
})

export const jobSchema = jobSummarySchema.extend({
  labels: z.record(z.string(), z.string()),
  generation: z.string().nullable(),
  reconciling: z.boolean(),
  create_time: z.string().nullable(),
  creator: z.string().nullable(),
  launch_stage: z.string().nullable(),
  conditions: z.array(conditionSchema),
  task_count: z.number().nullable(),
  parallelism: z.number().nullable(),
  template: z.object(taskTemplateShape),
})

export type TaskTemplateReply = z.infer<typeof taskTemplateReply>
export type JobReply = z.infer<typeof jobReply>
export type JobSummary = z.infer<typeof jobSummarySchema>
export type JobView = z.infer<typeof jobSchema>
export type TaskTemplate = z.infer<z.ZodObject<typeof taskTemplateShape>>

/** A task template as its settings and retries, with no environment value. */
export function taskTemplate(reply: TaskTemplateReply = {}): TaskTemplate {
  return { max_retries: reply.maxRetries ?? null, ...templateSettings(reply) }
}

/** A job for a list: its name, readiness and latest execution. */
export function jobSummary(reply: JobReply): JobSummary {
  const latest = reply.latestCreatedExecution
  return {
    job: shortName(reply.name),
    ready: statusView(reply.terminalCondition),
    update_time: reply.updateTime ?? null,
    last_modifier: reply.lastModifier ?? null,
    execution_count: reply.executionCount ?? 0,
    latest_execution: !latest?.name
      ? null
      : {
          execution: shortName(latest.name),
          status: COMPLETION_STATUSES[latest.completionStatus ?? ""] ?? "unknown",
          create_time: latest.createTime ?? null,
          completion_time: latest.completionTime ?? null,
        },
  }
}

/** A job in full: its settings and the template its executions run, with no environment value and no annotation. */
export function jobView(reply: JobReply): JobView {
  return {
    ...jobSummary(reply),
    labels: reply.labels ?? {},
    generation: generationText(reply.generation),
    reconciling: reply.reconciling ?? false,
    create_time: reply.createTime ?? null,
    creator: reply.creator ?? null,
    launch_stage: reply.launchStage ?? null,
    conditions: conditionViews(reply.conditions),
    task_count: reply.template?.taskCount ?? null,
    parallelism: reply.template?.parallelism ?? null,
    template: taskTemplate(reply.template?.template),
  }
}
