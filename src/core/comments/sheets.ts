import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { gridRangeA1 } from "../sheets/a1"
import { readingRanges } from "../sheets/range-errors"
import { parseReply } from "../sheets/reply"
import { COMMENTS_ROUTES } from "./routes"
import type { CommentReply, CommentThread } from "./schemas"
import { clipText, type LocatedThread, type ThreadPost } from "./thread"

const SPREADSHEET_FIELDS = "comments,sheets(properties(sheetId,title),commentAnchors)"

const COMMENTS_INCLUDED = "COMMENTS_VIEW_MODE_INCLUDED"

/** A single cell written as a range of itself (`Plan!B2:B2`); the capture is the cell. */
const SINGLE_CELL_PATTERN = /!([A-Z]+[0-9]+):\1$/

const postReply = z.object({
  postId: z.string(),
  content: z.string().optional(),
  author: z.object({ displayName: z.string().optional(), me: z.boolean().optional() }).optional(),
  createTime: z.string().optional(),
  updateTime: z.string().optional(),
  deleted: z.boolean().optional(),
  assigneeEmail: z.string().optional(),
  commentAction: z.string().optional(),
})

const spreadsheetReply = z.object({
  comments: z
    .array(
      z.object({
        commentId: z.string(),
        anchorId: z.string().optional(),
        status: z.string().optional(),
        headPost: postReply.optional(),
        replies: z.array(postReply).optional(),
        plainTextQuote: z.string().optional(),
      }),
    )
    .optional(),
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: z.number().int().optional(), title: z.string().optional() }).optional(),
        commentAnchors: z
          .array(
            z.object({
              anchorId: z.string(),
              range: z
                .object({
                  sheetId: z.number().int().optional(),
                  startRowIndex: z.number().int().optional(),
                  endRowIndex: z.number().int().optional(),
                  startColumnIndex: z.number().int().optional(),
                  endColumnIndex: z.number().int().optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

type SpreadsheetReply = z.output<typeof spreadsheetReply>
type Thread = NonNullable<SpreadsheetReply["comments"]>[number]
type Post = z.output<typeof postReply>

/** The A1 notation of every anchor by its id, with the tab it is on; an anchor on a tab the reply does not list is left out. Google leaves a `sheetId` of 0 out. */
function anchorCells(sheets: SpreadsheetReply["sheets"]): Map<string, string> {
  const titles = new Map<number, string>()
  for (const { properties } of sheets ?? []) {
    if (properties?.title !== undefined) titles.set(properties.sheetId ?? 0, properties.title)
  }
  const cells = new Map<string, string>()
  for (const { commentAnchors } of sheets ?? []) {
    for (const { anchorId, range } of commentAnchors ?? []) {
      const title = titles.get(range?.sheetId ?? 0)
      if (range !== undefined && title !== undefined) {
        cells.set(anchorId, gridRangeA1(title, range).replace(SINGLE_CELL_PATTERN, "!$1"))
      }
    }
  }
  return cells
}

function replyAction(action: string | undefined): CommentReply["action"] {
  if (action === "RESOLVE") return "resolve"
  return action === "REOPEN" ? "reopen" : null
}

function toReply(post: Post): CommentReply {
  return {
    reply_id: post.postId,
    author: post.author?.displayName || null,
    me: post.author?.me ?? false,
    ...clipText(post.content ?? ""),
    time: post.updateTime ?? post.createTime ?? null,
    action: replyAction(post.commentAction),
    assignee: post.assigneeEmail || null,
  }
}

function statusOf(thread: Thread): CommentThread["status"] {
  return thread.status === "RESOLVED" ? "resolved" : "open"
}

/** The cell of the thread; a thread with no anchor, or one the reply does not list, has none. */
function cellOf(thread: Thread, cells: ReadonlyMap<string, string>): string | null {
  return thread.anchorId === undefined ? null : (cells.get(thread.anchorId) ?? null)
}

/** The thread as the read returns it; `undefined` for one whose first post was deleted. */
function toThread(thread: Thread, cells: ReadonlyMap<string, string>): CommentThread | undefined {
  const head = thread.headPost
  if (head === undefined || head.deleted === true) return undefined
  return {
    comment_id: thread.commentId,
    status: statusOf(thread),
    at: cellOf(thread, cells),
    quote: thread.plainTextQuote || null,
    author: head.author?.displayName || null,
    me: head.author?.me ?? false,
    ...clipText(head.content ?? ""),
    time: head.updateTime ?? head.createTime ?? null,
    assignee: head.assigneeEmail || null,
    replies: (thread.replies ?? []).filter((post) => post.deleted !== true).map(toReply),
  }
}

function toPost(post: Post): ThreadPost {
  return {
    postId: post.postId,
    author: post.author?.displayName || null,
    me: post.author?.me ?? false,
    text: post.content ?? "",
    action: replyAction(post.commentAction),
    assignee: post.assigneeEmail || null,
  }
}

async function readSpreadsheet(
  client: GoogleClient,
  spreadsheetId: string,
  ranges: readonly string[] | undefined,
): Promise<SpreadsheetReply> {
  return parseReply(
    spreadsheetReply,
    await client.request(COMMENTS_ROUTES.spreadsheet, {
      params: { spreadsheet_id: spreadsheetId },
      query: { fields: SPREADSHEET_FIELDS, commentsViewMode: COMMENTS_INCLUDED, ranges },
    }),
    "a spreadsheet's comments",
  )
}

/**
 * Every comment thread of the spreadsheet `spreadsheetId`, in the order Google
 * gives, each with the cell it is anchored to. With `ranges`, Google gives
 * only the threads anchored inside them. A thread whose first post was deleted
 * and the replies that were deleted are left out.
 */
export async function readSpreadsheetComments(
  client: GoogleClient,
  spreadsheetId: string,
  ranges: readonly string[] | undefined,
): Promise<CommentThread[]> {
  const reply = await readingRanges(() => readSpreadsheet(client, spreadsheetId, ranges))
  const cells = anchorCells(reply.sheets)
  return (reply.comments ?? []).flatMap((thread) => toThread(thread, cells) ?? [])
}

/**
 * The thread `commentId` of the spreadsheet `spreadsheetId` with its posts as
 * Google has them, whole; `undefined` when it has none or its first post was
 * deleted. The replies that were deleted are left out.
 */
export async function findSpreadsheetThread(
  client: GoogleClient,
  spreadsheetId: string,
  commentId: string,
): Promise<LocatedThread | undefined> {
  const reply = await readSpreadsheet(client, spreadsheetId, undefined)
  const thread = (reply.comments ?? []).find((candidate) => candidate.commentId === commentId)
  const head = thread?.headPost
  if (thread === undefined || head === undefined || head.deleted === true) return undefined
  return {
    commentId,
    status: statusOf(thread),
    at: cellOf(thread, anchorCells(reply.sheets)),
    head: toPost(head),
    replies: (thread.replies ?? []).filter((post) => post.deleted !== true).map(toPost),
  }
}
