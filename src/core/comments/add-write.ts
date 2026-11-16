import { z } from "zod"
import { parseReply } from "../sheets/reply"
import type { CommentsAddResult } from "./add-args"
import type { CommentPlan } from "./add-plan"
import { COMMENTS_ROUTES } from "./routes"
import { commentRefusal, requireSaved } from "./write-guards"

/** The `fields` of a created comment or reply: only its id is used. */
const CREATED_FIELDS = "id"

/** Why the comment was not added when Google refused it on a file these tools did not create. */
const ADD_REFUSED =
  "Google refused the comment: these tools can comment only on spreadsheets and on the files they created (drive.file), and nothing was added."

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
  requireSaved(reply.commentUpdateState, "the comment", "It may or may not be there")
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
    throw commentRefusal(error, ADD_REFUSED) ?? error
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
