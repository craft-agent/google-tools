import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import type { CommentsDeleteArgs } from "./delete-args"
import { COMMENTS_ROUTES } from "./routes"
import type { ThreadPost } from "./thread"
import { locateThread, postOf, type ThreadPlan } from "./thread-plan"
import { requireOwnPost } from "./write-guards"

/** The live replies a delete takes with it: every reply of a thread, none for a reply. */
export function deletedReplies({ thread, reply }: Pick<ThreadPlan, "thread" | "reply">): ThreadPost[] {
  return reply === null ? thread.replies : []
}

/**
 * Locates the post and checks the delete, before anything is written: the
 * post (the thread's first post, for a thread) must be the account's
 * (`forbidden`), and a spreadsheet keeps a reply that resolves or reopens the
 * thread or assigns it (`invalid_argument`). Whatever this refuses, `execute`
 * refuses, and a description is made from it.
 */
export async function planDelete(args: CommentsDeleteArgs, ctx: ToolContext): Promise<ThreadPlan> {
  const plan = await locateThread(
    args,
    ctx,
    args.reply_id === undefined ? COMMENTS_ROUTES.commentDelete : COMMENTS_ROUTES.replyDelete,
  )
  const post = postOf(plan)
  requireOwnPost(post, "delete")
  if (plan.file.isSpreadsheet && plan.reply !== null && (plan.reply.action !== null || plan.reply.assignee !== null)) {
    throw new ToolError(
      "invalid_argument",
      "Google keeps a spreadsheet's reply that resolves or reopens the thread or assigns it, so it cannot be deleted on its own; only deleting the whole thread removes it.",
    )
  }
  return plan
}
