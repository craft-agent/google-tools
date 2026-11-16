import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import { StepErrors, type ToolContext } from "../tool"
import { mailRoutes, selectMail, type MailSelection } from "./mail-items"
import type { GmailTrashArgs, GmailTrashResult } from "./trash-args"

/** What the trash tool names its work as when a call has no runtime. */
export const TRASH_WORK = "Gmail trash"

/** A move to the trash planned: the mail it moves and the client that moves it. */
export type TrashPlan = { client: GoogleClient; label: string; selection: MailSelection }

/** Checks the arguments (the mail), then the label's scopes, before anything is read or written. */
export async function planTrash(args: GmailTrashArgs, ctx: ToolContext): Promise<TrashPlan> {
  const selection = selectMail(args)
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, args.account, TRASH_WORK)
  await client.requireScopes(mailRoutes(selection.kind).trash)
  return { client, label, selection }
}

/**
 * Moves the planned mail to the trash, one request each and in order. A
 * failure of the first one throws, since nothing was moved; a failure of a
 * later one stops the call and is listed under `errors` beside what was
 * trashed, so what the call did is never lost.
 */
export async function trashAll({ client, selection }: TrashPlan): Promise<GmailTrashResult> {
  const { trash, param } = mailRoutes(selection.kind)
  const trashOne = async (id: string) => {
    await client.request(trash, { params: { [param]: id } })
    return true
  }
  const [first, ...rest] = selection.ids
  const trashed: string[] = []
  const steps = new StepErrors()
  await trashOne(first!)
  trashed.push(first!)
  for (const id of rest) {
    if (!(await steps.record(id, () => trashOne(id)))) break
    trashed.push(id)
  }
  return { trashed: trashed.length, ids: trashed, ...(steps.any && { errors: steps.errors }) }
}
