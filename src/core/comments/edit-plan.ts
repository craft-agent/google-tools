import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import type { CommentsEditArgs } from "./edit-args"
import { mentionedAddresses } from "./mentions"
import { COMMENTS_ROUTES } from "./routes"
import { locateThread, postOf, type ThreadPlan } from "./thread-plan"
import { requireOwnPost, requireSpreadsheetLength } from "./write-guards"

/** An edit planned: the post as Google has it now, and the text that replaces its words. */
export type EditPlan = ThreadPlan & { text: string }

/** The addresses `text` mentions that `old` did not: the ones an edit would have Google email. */
function newMentions(old: string, text: string): string[] {
  const before = new Set(mentionedAddresses(old))
  return mentionedAddresses(text).filter((address) => !before.has(address))
}

/**
 * Locates the post and checks the edit, before anything is written: the post
 * must be the account's (`forbidden`), a spreadsheet's text must fit Google's
 * limit in bytes, and the new text may not mention an address the old text did
 * not, since an edit emails nobody (`invalid_argument`). Whatever this
 * refuses, `execute` refuses, and a description is made from it.
 */
export async function planEdit(args: CommentsEditArgs, ctx: ToolContext): Promise<EditPlan> {
  const plan = await locateThread(
    args,
    ctx,
    args.reply_id === undefined ? COMMENTS_ROUTES.commentUpdate : COMMENTS_ROUTES.replyUpdate,
  )
  const post = postOf(plan)
  requireOwnPost(post, "edit")
  if (plan.file.isSpreadsheet) requireSpreadsheetLength(args.text)
  const mentioned = newMentions(post.text, args.text)
  if (mentioned.length > 0) {
    throw new ToolError(
      "invalid_argument",
      `The new text mentions ${mentioned.join(", ")}, which the old text did not. An edit emails nobody; to mention someone, add a reply with \`google_comments_add\`.`,
    )
  }
  return { ...plan, text: args.text }
}
