import { z } from "zod"
import { taskTemplate, taskTemplateReply, taskTemplateShape } from "./job-view"
import { shortName, shortNameOrNull } from "./names"
import { completedStatus, conditionSchema, conditionsReply, conditionViews, runStatusSchema } from "./status-view"

/** An execution as Google gives it; the annotations and every field not read here are left out of the parse. */
export const executionReply = z.object({
  name: z.string().optional(),
  job: z.string().optional(),
  createTime: z.string().optional(),
  startTime: z.string().optional(),
  completionTime: z.string().optional(),
  taskCount: z.number().optional(),
  parallelism: z.number().optional(),
  runningCount: z.number().optional(),
  succeededCount: z.number().optional(),
  failedCount: z.number().optional(),
  cancelledCount: z.number().optional(),
  retriedCount: z.number().optional(),
  logUri: z.string().optional(),
  conditions: conditionsReply,
  template: taskTemplateReply.optional(),
})

/** A task as Google gives it. */
export const taskReply = z.object({
  name: z.string().optional(),
  index: z.number().optional(),
  retried: z.number().optional(),
  startTime: z.string().optional(),
  completionTime: z.string().optional(),
  logUri: z.string().optional(),
  conditions: conditionsReply,
  lastAttemptResult: z
    .object({
      exitCode: z.number().optional(),
      status: z.object({ message: z.string().optional() }).optional(),
    })
    .optional(),
})

export const executionSummarySchema = z.object({
  execution: z.string(),
  create_time: z.string().nullable(),
  start_time: z.string().nullable(),
  completion_time: z.string().nullable(),
  task_count: z.number().nullable(),
  running: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  cancelled: z.number(),
  retried: z.number(),
  status: runStatusSchema,
  log_uri: z.string().nullable(),
})

export const executionSchema = executionSummarySchema.extend({
  job: z.string().nullable(),
  parallelism: z.number().nullable(),
  conditions: z.array(conditionSchema),
  template: z.object(taskTemplateShape),
})

export const taskSchema = z.object({
  task: z.string(),
  index: z.number().nullable(),
  retried: z.number(),
  start_time: z.string().nullable(),
  completion_time: z.string().nullable(),
  status: runStatusSchema,
  last_attempt: z.object({ exit_code: z.number().nullable(), message: z.string().nullable() }).nullable(),
  log_uri: z.string().nullable(),
})

export type ExecutionReply = z.infer<typeof executionReply>
export type TaskReply = z.infer<typeof taskReply>
export type ExecutionSummary = z.infer<typeof executionSummarySchema>
export type ExecutionView = z.infer<typeof executionSchema>
export type TaskView = z.infer<typeof taskSchema>

/** An execution for a list: its name, times, task counts and how it ended. */
export function executionSummary(reply: ExecutionReply): ExecutionSummary {
  return {
    execution: shortName(reply.name),
    create_time: reply.createTime ?? null,
    start_time: reply.startTime ?? null,
    completion_time: reply.completionTime ?? null,
    task_count: reply.taskCount ?? null,
    running: reply.runningCount ?? 0,
    succeeded: reply.succeededCount ?? 0,
    failed: reply.failedCount ?? 0,
    cancelled: reply.cancelledCount ?? 0,
    retried: reply.retriedCount ?? 0,
    status: completedStatus(reply.conditions),
    log_uri: reply.logUri ?? null,
  }
}

/** An execution in full: its conditions and the template it ran, with no environment value and no annotation. */
export function executionView(reply: ExecutionReply): ExecutionView {
  return {
    ...executionSummary(reply),
    job: shortNameOrNull(reply.job),
    parallelism: reply.parallelism ?? null,
    conditions: conditionViews(reply.conditions),
    template: taskTemplate(reply.template),
  }
}

/** A task: when it ran, how it ended and the exit code and message of its last attempt. */
export function taskView(reply: TaskReply): TaskView {
  const attempt = reply.lastAttemptResult
  return {
    task: shortName(reply.name),
    index: reply.index ?? 0,
    retried: reply.retried ?? 0,
    start_time: reply.startTime ?? null,
    completion_time: reply.completionTime ?? null,
    status: completedStatus(reply.conditions),
    last_attempt:
      attempt === undefined ? null : { exit_code: attempt.exitCode ?? 0, message: attempt.status?.message ?? null },
    log_uri: reply.logUri ?? null,
  }
}
