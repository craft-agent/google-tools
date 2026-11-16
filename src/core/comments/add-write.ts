import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import { parseReply } from "../sheets/reply"
import type { CommentsAddResult } from "./add-args"
import type { CommentPlan } from "./add-plan"
import { COMMENTS_ROUTES } from "./routes"

/** The state of a batch whose comment changes all went through. */
const ALL_SAVED = "ALL_SAVED"

/** The state a batch is taken to be in when its answer names none. */
const UNREPORTED_STATE = "COMMENT_UPDATE_STATE_UNSPECIFIED"

/** The most characters of the state Google reported that an error repeats. */
const MAX_STATE_LENGTH = 60

/** The `fields` of a created comment or reply: only its id is used. */
const CREATED_FIELDS = "id"

const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404

/** `spreadsheets.batchUpdate`'s answer to one comment request; each part is optional, since the comment may be saved all the same. */
const batchReply = z.object({
  replies: z
    .array(
      z.object({
        insertComment: z
          .object({ commentThread: z.object({ commentId: z.string().optional() }).optional() })
          .optional(),
        addCommentReply: z.object({ post: z.object({ postId: z.string().optional() }).optional() }).optional(),
      }),
    )
    .optional(),
  commentUpdateState: z.string().optional(),
})

const createdReply = z.object({ id: z.string().optional() })

/** What a write of a comment gives back: the thread's id (for a new one) and the reply's id, each when Google reported it. */
type Written = { commentId?: string | undefined; replyId?: string | undefined }

/**
 * The `forbidden` error for a create Google refused with a 403 or a 404 on a
 * file the plan had read: drive.file lets these tools comment only on the
 * files they created, and Google words the rest as either. A rate limit and
 * any other failure give `undefined`.
 */
function commentRefusal(error: unknown): ToolError | undefined {
  if (!isToolError(error) || error.code === "rate_limited") return undefined
  const status = error.details?.status
  if (status !== HTTP_FORBIDDEN && status !== HTTP_NOT_FOUND) return undefined
  return new ToolError(
    "forbidden",
    "Google refused the comment: these tools can comment only on spreadsheets and on the files they created (drive.file), and nothing was added.",
    { cause: error, details: { status } },
  )
}

/** The one request of a spreadsheet's comment: a new comment on its cell, or a reply to its thread. */
function sheetRequest({ cell, thread, text, assignee }: CommentPlan): Record<string, unknown> {
  if (thread !== null) {
    return {
      addCommentReply: {
        commentId: thread.commentId,
        post: { content: text, ...(assignee !== null && { assigneeEmail: assignee }) },
      },
    }
  }
  return {
    insertComment: {
      content: text,
      coordinate: cell?.coordinate,
      ...(assignee !== null && { assigneeEmailAddress: assignee }),
    },
  }
}

/** Saves a spreadsheet's comment; any state of the batch but `ALL_SAVED` is `upstream_error`, since the comment may or may not be there. */
async function writeSheetComment(plan: CommentPlan): Promise<Written> {
  const reply = parseReply(
    batchReply,
    await plan.client.request(COMMENTS_ROUTES.batchUpdate, {
      params: { spreadsheet_id: plan.file.fileId },
      body: { requests: [sheetRequest(plan)] },
    }),
    "the comment",
  )
  const state = reply.commentUpdateState ?? UNREPORTED_STATE
  if (state !== ALL_SAVED) {
    throw new ToolError(
      "upstream_error",
      `Google did not report the comment as saved (comment update state ${state.slice(0, MAX_STATE_LENGTH)}). It may or may not be there: read the file's comments before trying again.`,
    )
  }
  const first = reply.replies?.[0]
  return {
    commentId: first?.insertComment?.commentThread?.commentId,
    replyId: first?.addCommentReply?.post?.postId,
  }
}

/** Creates a comment, or a reply to the comment of the plan, on a file that is not a spreadsheet. */
async function writeDriveComment({ client, file, thread, text }: CommentPlan): Promise<Written> {
  try {
    const created = parseReply(
      createdReply,
      thread === null
        ? await client.request(COMMENTS_ROUTES.commentCreate, {
            params: { file_id: file.fileId },
            query: { fields: CREATED_FIELDS },
            body: { content: text },
          })
        : await client.request(COMMENTS_ROUTES.replyCreate, {
            params: { file_id: file.fileId, comment_id: thread.commentId },
            query: { fields: CREATED_FIELDS },
            body: { content: text },
          }),
      "the comment",
    )
    return thread === null ? { commentId: created.id } : { replyId: created.id }
  } catch (error) {
    throw commentRefusal(error) ?? error
  }
}

/** Writes the planned comment and returns what it made, with what the plan knows where Google's answer lacks an id. */
export async function addComment(plan: CommentPlan): Promise<CommentsAddResult> {
  const written = await (plan.file.isSpreadsheet ? writeSheetComment(plan) : writeDriveComment(plan))
  return {
    file_id: plan.file.fileId,
    comment_id: plan.thread?.commentId ?? written.commentId ?? "",
    reply_id: plan.thread === null ? null : (written.replyId ?? null),
    at: plan.cell?.at ?? plan.thread?.at ?? null,
    assignee: plan.assignee,
    emailed: plan.emailed.map(({ address }) => address),
  }
}
