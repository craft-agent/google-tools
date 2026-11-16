import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { COMMENTS_ROUTES } from "./routes"
import { DRIVE_PAGE_SIZE, MAX_DRIVE_PAGES, type CommentReply, type CommentThread } from "./schemas"
import { clipText } from "./thread"

const AUTHOR_FIELDS = "author(displayName,me)"

const REPLY_FIELDS = `id,${AUTHOR_FIELDS},content,createdTime,modifiedTime,deleted,action,assigneeEmailAddress`

const COMMENT_FIELDS = `comments(id,${AUTHOR_FIELDS},content,createdTime,modifiedTime,resolved,deleted,quotedFileContent(value),assigneeEmailAddress,replies(${REPLY_FIELDS})),nextPageToken`

/** What a comment and a reply to it share. */
const entryReply = z.object({
  id: z.string(),
  author: z.object({ displayName: z.string().optional(), me: z.boolean().optional() }).optional(),
  content: z.string().optional(),
  createdTime: z.string().optional(),
  modifiedTime: z.string().optional(),
  deleted: z.boolean().optional(),
  assigneeEmailAddress: z.string().optional(),
})

const replyReply = entryReply.extend({ action: z.string().optional() })

const listReply = z.object({
  comments: z
    .array(
      entryReply.extend({
        resolved: z.boolean().optional(),
        quotedFileContent: z.object({ value: z.string().optional() }).optional(),
        replies: z.array(replyReply).optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
})

type Comment = NonNullable<z.output<typeof listReply>["comments"]>[number]

/** The threads a file's comments gave, in Google's order, and whether the read stopped with pages left. */
export type FoundThreads = { threads: CommentThread[]; incomplete: boolean }

function replyAction(action: string | undefined): CommentReply["action"] {
  if (action === "resolve" || action === "reopen") return action
  return null
}

function toReply(reply: z.output<typeof replyReply>): CommentReply {
  return {
    reply_id: reply.id,
    author: reply.author?.displayName || null,
    me: reply.author?.me ?? false,
    ...clipText(reply.content ?? ""),
    time: reply.modifiedTime ?? reply.createdTime ?? null,
    action: replyAction(reply.action),
    assignee: reply.assigneeEmailAddress || null,
  }
}

/** The thread as the read returns it; Drive anchors no cell, so `at` is `null`. */
function toThread(comment: Comment): CommentThread {
  return {
    comment_id: comment.id,
    status: comment.resolved === true ? "resolved" : "open",
    at: null,
    quote: comment.quotedFileContent?.value || null,
    author: comment.author?.displayName || null,
    me: comment.author?.me ?? false,
    ...clipText(comment.content ?? ""),
    time: comment.modifiedTime ?? comment.createdTime ?? null,
    assignee: comment.assigneeEmailAddress || null,
    replies: (comment.replies ?? []).filter((reply) => reply.deleted !== true).map(toReply),
  }
}

/**
 * The comment threads of the file `fileId`, in Drive's order, up to
 * `MAX_DRIVE_PAGES` pages of `DRIVE_PAGE_SIZE`; `incomplete` when pages were
 * left. Deleted comments and deleted replies are left out.
 */
export async function readDriveComments(client: GoogleClient, fileId: string): Promise<FoundThreads> {
  const threads: CommentThread[] = []
  let pageToken: string | undefined
  for (let page = 1; page <= MAX_DRIVE_PAGES; page++) {
    const reply = parseReply(
      listReply,
      await client.request(COMMENTS_ROUTES.comments, {
        params: { file_id: fileId },
        query: { fields: COMMENT_FIELDS, pageSize: DRIVE_PAGE_SIZE, pageToken },
      }),
      "the comment list",
    )
    threads.push(...(reply.comments ?? []).filter((comment) => comment.deleted !== true).map(toThread))
    pageToken = reply.nextPageToken
    if (pageToken === undefined) return { threads, incomplete: false }
  }
  return { threads, incomplete: true }
}
