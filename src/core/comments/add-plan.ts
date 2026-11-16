import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import { columnLetters, quoteTab } from "../sheets/a1"
import { resolveRange } from "../sheets/grid"
import { readTabs, shownRange } from "../sheets/tabs"
import type { ToolContext } from "../tool"
import type { CommentsAddArgs } from "./add-args"
import { readDriveComment } from "./drive"
import { readCommentFile, type CommentFile } from "./file"
import { commentFileId, commentId } from "./ids"
import { mentionedAddresses } from "./mentions"
import { COMMENTS_ROUTES } from "./routes"
import { COMMENTS_TOOLSET } from "./scopes"
import type { CommentThread } from "./schemas"
import { readSpreadsheetComments } from "./sheets"
import { COMMENT_WRITES, SOME_WRITE, requireSpreadsheetLength } from "./write-guards"

/** Why Google emails an address. */
export type EmailRole = "assignee" | "mentioned"

export type Emailed = { address: string; role: EmailRole }

/** The cell of a new spreadsheet comment: how the prompt and the result name it, its tab's title and where Google puts it. */
export type NewCell = {
  at: string
  tabTitle: string
  coordinate: { sheetId: number; rowIndex: number; columnIndex: number }
}

/** The thread a reply goes to, as the file has it now. */
export type RepliedThread = {
  commentId: string
  author: string | null
  text: string
  resolved: boolean
  at: string | null
  assignee: string | null
}

/**
 * A comment planned: the file as Google reports it, the words, who Google
 * emails, and where it goes: `cell` for a new spreadsheet comment, `thread`
 * for a reply, neither for a new comment on another file. Describing,
 * targeting and writing all work from this.
 */
export type CommentPlan = {
  client: GoogleClient
  label: string
  file: CommentFile
  text: string
  assignee: string | null
  emailed: Emailed[]
  cell: NewCell | null
  thread: RepliedThread | null
}

/** The where of a plan: what the file kind and the arguments settle. */
type Placement = Pick<CommentPlan, "cell" | "thread">

function refuse(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

/** The write route a comment on `file` goes through. */
function writeRoute(file: CommentFile, replying: boolean): Route {
  if (file.isSpreadsheet) return COMMENTS_ROUTES.batchUpdate
  return replying ? COMMENTS_ROUTES.replyCreate : COMMENTS_ROUTES.commentCreate
}

/** The one cell `cell` names, in the spreadsheet's tabs; a range, a whole row or column and a tab alone are `invalid_argument`. */
async function resolveCell(client: GoogleClient, spreadsheetId: string, cell: string): Promise<NewCell> {
  const { tab, grid } = resolveRange((await readTabs(client, spreadsheetId)).tabs, cell)
  const { startRowIndex: row, endRowIndex, startColumnIndex: column, endColumnIndex } = grid
  if (row === undefined || column === undefined || endRowIndex !== row + 1 || endColumnIndex !== column + 1) {
    throw refuse(`${JSON.stringify(shownRange(cell))} is not one cell; a comment goes on one cell, like \`Plan!B2\`.`)
  }
  return {
    at: `${quoteTab(tab.title)}!${columnLetters(column)}${row + 1}`,
    tabTitle: tab.title,
    coordinate: { sheetId: tab.sheetId, rowIndex: row, columnIndex: column },
  }
}

function repliedThread(thread: CommentThread): RepliedThread {
  return {
    commentId: thread.comment_id,
    author: thread.author,
    text: thread.text,
    resolved: thread.status === "resolved",
    at: thread.at,
    assignee: thread.assignee,
  }
}

/** The thread `replyTo` of a spreadsheet; `not_found` when it has none, or its first post was deleted. */
async function findThread(client: GoogleClient, spreadsheetId: string, replyTo: string): Promise<RepliedThread> {
  const found = (await readSpreadsheetComments(client, spreadsheetId, undefined)).find(
    (thread) => thread.comment_id === replyTo,
  )
  if (found === undefined) {
    throw new ToolError("not_found", "The spreadsheet has no comment thread with that `comment_id`; read its comments.")
  }
  return repliedThread(found)
}

/**
 * Where a comment on a spreadsheet goes: a new one on `cell`, or a reply to
 * the thread `replyTo`, exactly one of them. The text must fit Google's limit
 * in bytes, and only an assigned thread can be given an assignee in a reply.
 */
async function sheetPlacement(
  client: GoogleClient,
  file: CommentFile,
  args: CommentsAddArgs,
  replyTo: string | undefined,
): Promise<Placement> {
  if ((args.cell === undefined) === (replyTo === undefined)) {
    throw refuse(
      "Give exactly one of `cell` (a new comment on one cell, like `Plan!B2`) and `comment_id` (a reply to a thread).",
    )
  }
  requireSpreadsheetLength(args.text)
  if (args.cell !== undefined) return { cell: await resolveCell(client, file.fileId, args.cell), thread: null }
  const thread = await findThread(client, file.fileId, replyTo!)
  if (args.assignee !== undefined && thread.assignee === null) {
    throw refuse("Only a thread that is assigned can be reassigned, and this thread has no assignee.")
  }
  return { cell: null, thread }
}

/** Where a comment on a file that is not a spreadsheet goes: a new one, or a reply to the comment `replyTo`, read first. */
async function drivePlacement(
  client: GoogleClient,
  file: CommentFile,
  args: CommentsAddArgs,
  replyTo: string | undefined,
): Promise<Placement> {
  if (args.cell !== undefined) throw refuse("`cell` applies to a spreadsheet only; this file is not one.")
  if (args.assignee !== undefined) throw refuse("`assignee` applies to a spreadsheet only; this file is not one.")
  if (replyTo === undefined) return { cell: null, thread: null }
  const thread = await readDriveComment(client, file.fileId, replyTo)
  if (thread === undefined) {
    throw new ToolError("not_found", "That comment was deleted; read the file's comments for the ones it has.")
  }
  return { cell: null, thread: repliedThread(thread) }
}

/** The addresses Google emails: the assignee, then each one the text mentions that is not the assignee. */
function emailedOf(assignee: string | null, text: string): Emailed[] {
  const emailed: Emailed[] = assignee === null ? [] : [{ address: assignee, role: "assignee" }]
  for (const address of mentionedAddresses(text)) {
    if (address !== assignee) emailed.push({ address, role: "mentioned" })
  }
  return emailed
}

/**
 * Plans a comment from the arguments and what Google reports, before anything
 * is written. A label's scopes are checked ahead of what they allow: the file
 * read (drive.readonly) and one of the writes before the file is read, so a
 * label that cannot write fails with no comment-related request, and the
 * write the file's kind needs right after it, before the cell, the tabs or
 * the threads are read. Whatever this refuses, `execute` refuses, and a
 * description is made from it.
 */
export async function planComment(args: CommentsAddArgs, ctx: ToolContext): Promise<CommentPlan> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const fileId = commentFileId(args.file)
  const replyTo = args.comment_id === undefined ? undefined : commentId(args.comment_id, "comment id")
  const { client, label } = await googleSession(ctx, args.account, COMMENT_WRITES, COMMENTS_TOOLSET)
  await client.requireScopes(COMMENTS_ROUTES.file)
  await client.requireScopes(SOME_WRITE)
  const file = await readCommentFile(client, fileId)
  await client.requireScopes(writeRoute(file, replyTo !== undefined))
  const placement = file.isSpreadsheet
    ? await sheetPlacement(client, file, args, replyTo)
    : await drivePlacement(client, file, args, replyTo)
  const assignee = args.assignee ?? null
  return { client, label, file, text: args.text, assignee, emailed: emailedOf(assignee, args.text), ...placement }
}
