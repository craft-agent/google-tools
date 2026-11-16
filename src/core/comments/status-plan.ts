import type { ToolContext } from "../tool"
import type { CommentsStatusArgs } from "./status-args"
import { COMMENTS_ROUTES } from "./routes"
import { locateThread, type ThreadPlan } from "./thread-plan"

/** A change of a thread's status planned: the thread as Google has it now, and the status the call asks for. */
export type StatusPlan = ThreadPlan & { status: CommentsStatusArgs["status"] }

/** Whether the call changes anything: the thread has another status than the one asked for. */
export function changesStatus({ thread, status }: Pick<StatusPlan, "thread" | "status">): boolean {
  return thread.status !== status
}

/**
 * Locates the thread and the status asked for, before anything is written.
 * A reply that resolves or reopens is a post of its own, so the label must be
 * able to write one. Whatever this refuses, `execute` refuses, and a
 * description is made from it.
 */
export async function planStatus(args: CommentsStatusArgs, ctx: ToolContext): Promise<StatusPlan> {
  return { ...(await locateThread(args, ctx, COMMENTS_ROUTES.replyCreate)), status: args.status }
}
