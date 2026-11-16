import { z } from "zod"

/** The methods of the Gmail read. */
export const GMAIL_METHODS = ["search", "message", "thread", "labels", "attachment", "drafts", "draft"] as const

/** What `search` returns when `limit` is left out, and the most it returns. */
export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 50

/** The most characters of a `search` query, a file name and a part id. */
export const MAX_QUERY_LENGTH = 2000
export const MAX_NAME_LENGTH = 200
export const MAX_PART_LENGTH = 100

/** The most characters (code points) of one message's body, and of all the bodies of a thread. */
export const MAX_BODY_CHARACTERS = 20_000
export const MAX_THREAD_BODY_CHARACTERS = 60_000

/** The most MiB, and so bytes, of one attachment that `attachment` saves. */
export const MAX_ATTACHMENT_MIB = 25
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MIB * 1024 * 1024

/** How a message body was made: its text parts, its HTML parts turned into text, or there was none. */
export const BODY_FORMATS = ["text", "html_as_text", "none"] as const

export const accountArg = z
  .string()
  .optional()
  .describe(
    "The account's label. Left out, the only account is used; with several accounts, the call fails and lists them.",
  )

/** A draft's id, as `google_gmail_read` and the draft tools give it and take it. */
export const draftIdArg = z
  .string()
  .min(1)
  .describe("The id of the draft: the `draft_id` that `google_gmail_read` method `drafts` or a draft tool gave.")

export const gmailReadInput = z.strictObject({
  method: z.enum(GMAIL_METHODS),
  account: accountArg,
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe(
      "search, drafts: Gmail search syntax (`from:ann@example.com newer_than:7d has:attachment`); left out, the newest mail or every draft.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(
      `search, drafts: how many messages or drafts to return (1 to ${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`,
    ),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe("search, drafts: the `next_page_token` of the previous call, for the next page."),
  include_spam_trash: z.boolean().optional().describe("search: `true` also searches Spam and Trash (default false)."),
  message_id: z
    .string()
    .optional()
    .describe("message, attachment: the id a `search` or `thread` result gave as `message_id`."),
  thread_id: z.string().optional().describe("thread: the id a `search` or `message` result gave as `thread_id`."),
  draft_id: z.string().optional().describe("draft: the id a `drafts` result gave as `draft_id`."),
  part: z
    .string()
    .min(1)
    .max(MAX_PART_LENGTH)
    .optional()
    .describe("attachment: the `part` of an entry in the `attachments` of a `message` or `thread` result."),
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .optional()
    .describe(
      "attachment: what to name the saved file, without its extension (which is the attachment's own); left out, the attachment's file name.",
    ),
})

const headerValue = z.string().nullable()

export const searchedMessageSchema = z.object({
  message_id: z.string(),
  thread_id: z.string(),
  from: headerValue,
  to: headerValue,
  cc: headerValue,
  subject: headerValue,
  date: headerValue,
  snippet: z.string(),
  /** The ids of the message's labels, as `labels` lists them. */
  labels: z.array(z.string()),
})

export const attachmentEntrySchema = z.object({
  /** What `attachment` takes as `part`. */
  part: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size: z.number().int(),
})

export const messageSchema = z.object({
  message_id: z.string(),
  thread_id: z.string(),
  from: headerValue,
  to: headerValue,
  cc: headerValue,
  bcc: headerValue,
  reply_to: headerValue,
  subject: headerValue,
  date: headerValue,
  /** The RFC `Message-ID` header, which a reply refers to. */
  message_id_header: headerValue,
  labels: z.array(z.string()),
  body: z.string(),
  body_format: z.enum(BODY_FORMATS),
  /** Whether the body was cut at its character limit. */
  body_truncated: z.boolean(),
  attachments: z.array(attachmentEntrySchema),
})

export const draftSummarySchema = z.object({
  /** What `draft` and the draft tools take as `draft_id`. */
  draft_id: z.string(),
  message_id: z.string(),
  thread_id: z.string(),
  to: headerValue,
  cc: headerValue,
  bcc: headerValue,
  subject: headerValue,
  date: headerValue,
  snippet: z.string(),
})

export const labelSchema = z.object({
  label_id: z.string(),
  name: z.string(),
  type: z.enum(["system", "user"]),
  messages_total: z.number().int().optional(),
  messages_unread: z.number().int().optional(),
})

const searchOutput = {
  /** The messages found, newest first; the full messages of a thread, oldest first, for `thread`. */
  messages: z.union([z.array(searchedMessageSchema), z.array(messageSchema)]),
  next_page_token: z.string().nullable(),
  result_size_estimate: z.number().int(),
}

const messageOutput = messageSchema.shape

const draftsOutput = {
  /** The drafts found, newest first. */
  drafts: z.array(draftSummarySchema),
}

const draftOutput = {
  /** The draft a `draft` result is the message of. */
  draft_id: z.string(),
}

const labelsOutput = {
  /** For `labels`, the labels of the mailbox; for `message` and `thread`, the label ids of the message. */
  labels: z.union([z.array(labelSchema), z.array(z.string())]),
}

const attachmentOutput = {
  message_id: z.string(),
  part: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  /** The bytes saved. */
  size: z.number().int(),
  /** Where the attachment was saved. */
  path: z.string(),
}

/** One object for all seven methods, each filling its own keys. */
export const gmailReadOutput = z
  .object({
    ...messageOutput,
    ...searchOutput,
    ...labelsOutput,
    ...attachmentOutput,
    ...draftsOutput,
    ...draftOutput,
  })
  .partial()

export type GmailReadArgs = z.output<typeof gmailReadInput>
export type GmailMethod = (typeof GMAIL_METHODS)[number]
export type SearchedMessage = z.infer<typeof searchedMessageSchema>
export type AttachmentEntry = z.infer<typeof attachmentEntrySchema>
export type MessageView = z.infer<typeof messageSchema>
export type DraftSummary = z.infer<typeof draftSummarySchema>
export type GmailLabel = z.infer<typeof labelSchema>
export type SearchResult = {
  messages: SearchedMessage[]
  next_page_token: string | null
  result_size_estimate: number
}
export type DraftsResult = { drafts: DraftSummary[]; next_page_token: string | null }
export type DraftResult = MessageView & { draft_id: string }
export type ThreadResult = { thread_id: string; messages: MessageView[] }
export type LabelsResult = { labels: GmailLabel[] }
export type AttachmentResult = z.infer<z.ZodObject<typeof attachmentOutput>>
