import { z } from "zod"

/** The states a service, job or revision condition is shown in. */
const CONDITION_STATES = ["succeeded", "failed", "reconciling", "pending", "unknown"] as const

/** The states an execution or task is shown in. */
export const RUN_STATUSES = ["succeeded", "failed", "running", "pending", "cancelled", "unknown"] as const

/** A condition's state as Google names it, and what it is shown as. */
const STATE_NAMES = {
  CONDITION_SUCCEEDED: "succeeded",
  CONDITION_FAILED: "failed",
  CONDITION_RECONCILING: "reconciling",
  CONDITION_PENDING: "pending",
} as const

/** The type of the condition that says whether an execution or task has finished. */
const COMPLETED_TYPE = "Completed"

/** The type of the condition that says whether a revision is ready. */
const READY_TYPE = "Ready"

/** The execution reason of a run that was stopped on purpose. */
const CANCELLED_REASON = "CANCELLED"

/** The reason fields of a condition, in the order the first present one is taken. */
const REASON_KEYS = ["reason", "revisionReason", "executionReason", "instanceReason"] as const

/** A reason enum that says nothing: `*_UNDEFINED` and `*_UNSPECIFIED`. */
const EMPTY_REASON_PATTERN = /_(?:UNDEFINED|UNSPECIFIED)$/

/** A condition as Google gives it, a `terminalCondition` included; unknown keys and absent ones are fine. */
export const conditionReply = z.object({
  type: z.string().optional(),
  state: z.string().optional(),
  message: z.string().optional(),
  lastTransitionTime: z.string().optional(),
  reason: z.string().optional(),
  revisionReason: z.string().optional(),
  executionReason: z.string().optional(),
  instanceReason: z.string().optional(),
})

/** The conditions of a resource as Google gives them. */
export const conditionsReply = z.array(conditionReply).optional()

export const statusSchema = z.object({
  state: z.enum(CONDITION_STATES),
  /** Google's reason, as its enum names it. */
  reason: z.string().nullable(),
  message: z.string().nullable(),
  time: z.string().nullable(),
})

export const conditionSchema = statusSchema.extend({ type: z.string() })

export const runStatusSchema = z.enum(RUN_STATUSES)

export type ConditionReply = z.infer<typeof conditionReply>
export type Status = z.infer<typeof statusSchema>
export type ConditionView = z.infer<typeof conditionSchema>
export type RunStatus = z.infer<typeof runStatusSchema>

function reasonOf(condition: ConditionReply): string | null {
  for (const key of REASON_KEYS) {
    const reason = condition[key]
    if (reason !== undefined && reason !== "" && !EMPTY_REASON_PATTERN.test(reason)) return reason
  }
  return null
}

/** A condition as a status; an absent one is `unknown`. */
export function statusView(condition: ConditionReply | undefined): Status {
  const state = condition?.state
  return {
    state:
      state !== undefined && Object.hasOwn(STATE_NAMES, state)
        ? STATE_NAMES[state as keyof typeof STATE_NAMES]
        : "unknown",
    reason: condition === undefined ? null : reasonOf(condition),
    message: condition?.message ?? null,
    time: condition?.lastTransitionTime ?? null,
  }
}

/** Every condition with its type and status. */
export function conditionViews(conditions: readonly ConditionReply[] | undefined): ConditionView[] {
  return (conditions ?? []).map((condition) => ({ type: condition.type ?? "", ...statusView(condition) }))
}

/** The `Ready` condition of a revision, as a status. */
export function readyStatus(conditions: readonly ConditionReply[] | undefined): Status {
  return statusView(conditions?.find((condition) => condition.type === READY_TYPE))
}

/** Whether an execution or task is running, done or stopped, from its `Completed` condition; `unknown` when it has none. */
export function completedStatus(conditions: readonly ConditionReply[] | undefined): RunStatus {
  const condition = conditions?.find((candidate) => candidate.type === COMPLETED_TYPE)
  if (condition === undefined) return "unknown"
  if (condition.executionReason === CANCELLED_REASON) return "cancelled"
  const { state } = statusView(condition)
  if (state === "reconciling") return "running"
  return state === "succeeded" || state === "failed" || state === "pending" ? state : "unknown"
}
