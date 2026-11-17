import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { staleMessage, type ChangeRequest, type ChangeSession } from "./change"
import type { RunExecutionCancelArgs } from "./execution-cancel-args"
import { readExecutionState } from "./execution-state"
import type { ExecutionView } from "./execution-view"
import { shown } from "./ids"
import { RUN_ROUTES } from "./routes"
import { checkedExecution } from "./target"
import { runWriteSession } from "./write-session"

/** What a cancel says when the execution changed since it was read. */
const STALE_MESSAGE = staleMessage("execution", "cancelled")

/** A cancel planned: what is sent and the execution as it was. */
export type ExecutionCancelPlan = ChangeSession & {
  label: string
  job: string
  execution: string
  request: ChangeRequest
  /** The execution as it was read. */
  before: ExecutionView
  /** The execution's etag, which the write sends; `null` when there is none. */
  etag: string | null
}

/**
 * Checks the ids and the label's scopes before anything is read, then reads
 * the execution, which must exist and not have finished, and plans the cancel,
 * sent with the etag read.
 */
export async function planExecutionCancel(
  args: RunExecutionCancelArgs,
  ctx: ToolContext,
): Promise<ExecutionCancelPlan> {
  const { place, job, execution } = checkedExecution(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.executionCancel)
  const state = await readExecutionState(client, place, job, execution)
  if (state.view.completion_time !== null) {
    throw new ToolError("invalid_argument", `${shown(execution)} has already finished; nothing to cancel.`)
  }
  const request: ChangeRequest = {
    route: RUN_ROUTES.executionCancel,
    params: { ...place, job, execution },
    body: state.etag === null ? {} : { etag: state.etag },
    stale: STALE_MESSAGE,
  }
  return { client, runtime, place, label, job, execution, request, before: state.view, etag: state.etag }
}
