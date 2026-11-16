import { defineTool } from "../tool"
import { gmailDraftDeleteInput, gmailDraftDeleteOutput } from "./draft-args"
import { describeDraftDelete } from "./draft-facts"
import { planDraftDelete } from "./draft-plan"
import { existingDraftTarget } from "./draft-write"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_TOOLSET } from "./scopes"

export const googleGmailDraftDelete = defineTool({
  id: "google_gmail_draft_delete",
  title: "Delete Gmail draft",
  intent: "About to delete a draft",
  description:
    "Delete the draft `draft_id` (a `draft_id` that `google_gmail_read` method `drafts` or a draft tool gave) permanently: Gmail does not keep a deleted draft in the Trash, and it cannot be undone. One draft per call. " +
    "The prompt shows the draft's subject, its recipients and its date as Google holds them. " +
    "Returns the `draft_id` and `deleted: true`. " +
    "`account` is needed when several accounts are set up.",
  toolset: GMAIL_TOOLSET,
  class: "administrative",
  input: gmailDraftDeleteInput,
  output: gmailDraftDeleteOutput,
  targets: existingDraftTarget,
  async describe(args, ctx) {
    return describeDraftDelete(await planDraftDelete(args, ctx))
  },
  async execute(args, ctx) {
    const { client, current } = await planDraftDelete(args, ctx)
    await client.request(GMAIL_ROUTES.draftDelete, { params: { draft_id: current.draftId } })
    return { draft_id: current.draftId, deleted: true as const }
  },
})
