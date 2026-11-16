import { z } from "zod"
import { addressList, bodyArg, mailArgs } from "./send-args"
import { accountArg, draftIdArg } from "./schemas"

/** The recipients of a draft: it reaches no one, so there may be none, but one is needed before it is sent. */
const draftTo = addressList(0, "The recipients, possibly none while the mail is a draft (one is needed to send it)")

export const gmailDraftCreateInput = z.strictObject({
  account: accountArg,
  to: draftTo.optional(),
  ...mailArgs,
  body: bodyArg,
})

export const gmailDraftEditInput = z.strictObject({
  account: accountArg,
  draft_id: draftIdArg,
  to: draftTo.optional().describe(`${draftTo.description} The whole new message: nothing is kept from the old one.`),
  ...mailArgs,
  body: bodyArg,
})

export const gmailDraftOutput = z.object({
  draft_id: z.string().describe("The id of the draft; empty if Google did not report it."),
  message_id: z.string().describe("The id of the draft's message, which changes each time the draft is edited."),
  thread_id: z.string().describe("The id of its thread; empty if Google did not report it."),
})

export const gmailDraftDeleteInput = z.strictObject({ account: accountArg, draft_id: draftIdArg })

export const gmailDraftDeleteOutput = z.object({
  draft_id: z.string().describe("The id of the draft that was deleted."),
  deleted: z.literal(true),
})

export type GmailDraftOutput = z.output<typeof gmailDraftOutput>
export type GmailDraftCreateArgs = z.output<typeof gmailDraftCreateInput>
export type GmailDraftEditArgs = z.output<typeof gmailDraftEditInput>
export type GmailDraftDeleteArgs = z.output<typeof gmailDraftDeleteInput>
