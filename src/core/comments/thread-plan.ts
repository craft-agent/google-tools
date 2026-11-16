import { ToolError, isAbortError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { readDriveThread } from "./drive"
import { readCommentFile, type CommentFile } from "./file"
import { commentFileId, commentId } from "./ids"
import { COMMENTS_ROUTES } from "./routes"
import { COMMENTS_TOOLSET } from "./scopes"
import { findSpreadsheetThread } from "./sheets"
import type { LocatedThread, ThreadPost } from "./thread"
import { COMMENT_WRITES, SOME_WRITE } from "./write-guards"

/** What a change of one thread, or of one post of it, names. */
export type ThreadArgs = {
  account?: string | undefined
  file: string
  comment_id: string
  /** The reply the call is about; left out, the thread itself (its first post). */
  reply_id?: string | undefined
}

/**
 * A thread located for a change: the file and the thread as Google reports
 * them now, and the reply the call names, if it names one. Describing,
 * targeting and writing all work from this.
 */
export type ThreadPlan = {
  client: GoogleClient
  label: string
  file: CommentFile
  thread: LocatedThread
  reply: ThreadPost | null
}

/** The post a call on `plan` is about: the reply it names, else the thread's first post. */
export function postOf({ thread, reply }: Pick<ThreadPlan, "thread" | "reply">): ThreadPost {
  return reply ?? thread.head
}

/** The thread `comment` of `file` as Google has it now; `not_found` when it has none or was deleted. */
async function readThread(client: GoogleClient, file: CommentFile, comment: string): Promise<LocatedThread> {
  const thread = file.isSpreadsheet
    ? await findSpreadsheetThread(client, file.fileId, comment)
    : await readDriveThread(client, file.fileId, comment)
  if (thread === undefined) {
    throw new ToolError("not_found", "That comment does not exist or was deleted; read the file's comments.")
  }
  return thread
}

/**
 * Locates the thread `args` names, before anything is written. A label's
 * scopes are checked ahead of what they allow, as a new comment's are: the
 * file read (drive.readonly) and one of the writes before the file is read,
 * so a label that cannot write fails with no comment-related request, and
 * the write the file's kind needs right after it, before the thread is read.
 * `driveWrite` is the route a file that is not a spreadsheet is changed
 * through; a spreadsheet's is always the batch update. `not_found` when the
 * thread, or the reply `reply_id` names, is missing or deleted.
 */
export async function locateThread(args: ThreadArgs, ctx: ToolContext, driveWrite: Route): Promise<ThreadPlan> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const fileId = commentFileId(args.file)
  const comment = commentId(args.comment_id, "comment id")
  const replyId = args.reply_id === undefined ? undefined : commentId(args.reply_id, "reply id")
  const { client, label } = await googleSession(ctx, args.account, COMMENT_WRITES, COMMENTS_TOOLSET)
  await client.requireScopes(COMMENTS_ROUTES.file)
  await client.requireScopes(SOME_WRITE)
  const file = await readCommentFile(client, fileId)
  await client.requireScopes(file.isSpreadsheet ? COMMENTS_ROUTES.batchUpdate : driveWrite)
  const thread = await readThread(client, file, comment)
  if (replyId === undefined) return { client, label, file, thread, reply: null }
  const reply = thread.replies.find((post) => post.postId === replyId)
  if (reply === undefined) {
    throw new ToolError("not_found", "That reply does not exist or was deleted; read the file's comments.")
  }
  return { client, label, file, thread, reply }
}

/** The target `<label>/files/<id>/comments/<comment id>` of the thread a call changes, or `*` when it cannot be located; a cancellation is rethrown. */
export async function threadTargets(locate: () => Promise<ThreadPlan>, ctx: ToolContext): Promise<string[]> {
  try {
    const { label, file, thread } = await locate()
    return [`${label}/files/${file.fileId}/comments/${thread.commentId}`]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
