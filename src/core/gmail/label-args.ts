import { z } from "zod"
import { accountArg } from "./schemas"

/** The most messages and threads one label call changes. */
export const MAX_LABEL_MESSAGES = 1000
export const MAX_LABEL_THREADS = 100

/** The most labels one call adds, and the most it removes. */
export const MAX_LABEL_REFERENCES = 20

/** The most characters of a label's name, which Gmail limits too. */
export const MAX_LABEL_NAME_LENGTH = 225

/** The most characters a color argument may have, so a refusal never echoes a long text. */
const MAX_COLOR_LENGTH = 20

const labelReferences = (what: string) =>
  z
    .array(z.string().min(1).max(MAX_LABEL_NAME_LENGTH))
    .min(1)
    .max(MAX_LABEL_REFERENCES)
    .optional()
    .describe(
      `${what}, 1 to ${MAX_LABEL_REFERENCES}: each a label's name or id, or a system id such as \`INBOX\`, \`UNREAD\` or \`STARRED\`.`,
    )

export const gmailLabelInput = z.strictObject({
  account: accountArg,
  messages: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_LABEL_MESSAGES)
    .optional()
    .describe(
      `The messages to change, 1 to ${MAX_LABEL_MESSAGES} \`message_id\`s. Give exactly one of this and \`threads\`.`,
    ),
  threads: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_LABEL_THREADS)
    .optional()
    .describe(
      `The threads to change, 1 to ${MAX_LABEL_THREADS} \`thread_id\`s. Give exactly one of this and \`messages\`.`,
    ),
  add_labels: labelReferences("The labels to add"),
  remove_labels: labelReferences("The labels to remove"),
  untrash: z
    .literal(true)
    .optional()
    .describe("`true` first moves the messages or threads back out of the trash, then changes the labels."),
})

export const gmailLabelOutput = z.object({
  changed: z.number().int().describe("How many messages or threads the call changed."),
  adds: z.array(z.string()).describe("The names of the labels added, as Google names them."),
  removes: z.array(z.string()).describe("The names of the labels removed, as Google names them."),
  untrashed: z.number().int().describe("How many messages or threads were moved out of the trash."),
})

export const gmailLabelCreateInput = z.strictObject({
  account: accountArg,
  name: z
    .string()
    .min(1)
    .max(MAX_LABEL_NAME_LENGTH)
    .refine((name) => name === name.trim(), { error: "A label's name has no space at its start or its end." })
    .describe(
      `The new label's name, 1 to ${MAX_LABEL_NAME_LENGTH} characters with no space at either end; \`/\` nests it under another label, as Gmail does (\`Work/Invoices\`).`,
    ),
  text_color: z
    .string()
    .max(MAX_COLOR_LENGTH)
    .optional()
    .describe("The label's text color as `#rrggbb`, from Gmail's palette; given together with `background_color`."),
  background_color: z
    .string()
    .max(MAX_COLOR_LENGTH)
    .optional()
    .describe("The label's background color as `#rrggbb`, from Gmail's palette; given together with `text_color`."),
  show_in_list: z
    .boolean()
    .optional()
    .describe("Whether the label shows in the label list (default: Gmail's own default, shown)."),
  show_in_messages: z
    .boolean()
    .optional()
    .describe("Whether the label shows on messages in the message list (default: Gmail's own default, shown)."),
})

export const gmailLabelCreateOutput = z.object({
  label_id: z.string().describe("The new label's id, which the label tools take."),
  name: z.string().describe("The label's name as Google reports it."),
})

export type GmailLabelArgs = z.output<typeof gmailLabelInput>
export type GmailLabelResult = z.output<typeof gmailLabelOutput>
export type GmailLabelCreateArgs = z.output<typeof gmailLabelCreateInput>
