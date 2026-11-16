import { z } from "zod"
import { accountArg } from "./schemas"

/** The most messages, and the most threads, one trash call moves. */
export const MAX_TRASH_ITEMS = 100

/** How many days Gmail keeps mail in the trash before it deletes it. */
export const TRASH_RETENTION_DAYS = 30

export const gmailTrashInput = z.strictObject({
  account: accountArg,
  messages: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_TRASH_ITEMS)
    .optional()
    .describe(
      `The messages to trash, 1 to ${MAX_TRASH_ITEMS} \`message_id\`s. Give exactly one of this and \`threads\`.`,
    ),
  threads: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_TRASH_ITEMS)
    .optional()
    .describe(
      `The threads to trash, 1 to ${MAX_TRASH_ITEMS} \`thread_id\`s. Give exactly one of this and \`messages\`.`,
    ),
})

export const gmailTrashOutput = z.object({
  trashed: z.number().int().describe("How many messages or threads were moved to the trash."),
  ids: z.array(z.string()).describe("The ids of those, in the order given."),
  errors: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "The id whose move failed after earlier ones were trashed, with the reason; the ids after it were not tried.",
    ),
})

export type GmailTrashArgs = z.output<typeof gmailTrashInput>
export type GmailTrashResult = z.output<typeof gmailTrashOutput>
