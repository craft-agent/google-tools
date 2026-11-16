import { z } from "zod"
import { FILE_KINDS } from "../drive/kinds"
import { MAX_RANGES, MAX_RANGE_LENGTH, accountArg } from "../sheets/schemas"

/** What the read returns when `limit` is left out, and the most it returns. */
export const DEFAULT_COMMENTS = 50
export const MAX_COMMENTS = 200

/** The most code points of one comment's or reply's text; a longer one is clipped. */
export const MAX_TEXT_CHARACTERS = 4000

/** The most pages of comments read from Drive, and how many a page holds. */
export const MAX_DRIVE_PAGES = 10
export const DRIVE_PAGE_SIZE = 100

/** Whether a thread is open or resolved. */
export const THREAD_STATUSES = ["open", "resolved"] as const

/** What a reply did to its thread besides saying something. */
export const REPLY_ACTIONS = ["resolve", "reopen"] as const

export const commentsReadInput = z.strictObject({
  account: accountArg,
  file: z
    .string()
    .describe(
      "The file's id, or its URL (https://docs.google.com/spreadsheets/d/<id>/…, https://docs.google.com/document/d/<id>/…, https://drive.google.com/file/d/<id>/…).",
    ),
  resolved: z.boolean().optional().describe("`true` also returns the resolved threads (default false)."),
  ranges: z
    .array(z.string().min(1).max(MAX_RANGE_LENGTH))
    .min(1)
    .max(MAX_RANGES)
    .optional()
    .describe(
      `Spreadsheets only: 1 to ${MAX_RANGES} A1 ranges (\`Plan!B2:D4\`, \`'My tab'!A:C\`); only the threads anchored inside them are returned.`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_COMMENTS)
    .optional()
    .describe(`How many threads to return (1 to ${MAX_COMMENTS}, default ${DEFAULT_COMMENTS}).`),
})

const replySchema = z.object({
  /** For a spreadsheet, the id of the reply's post. */
  reply_id: z.string(),
  author: z.string().nullable(),
  /** Whether the account itself wrote it. */
  me: z.boolean(),
  text: z.string(),
  /** `true` when `text` was cut at `MAX_TEXT_CHARACTERS` characters. */
  text_clipped: z.boolean(),
  time: z.string().nullable(),
  /** What the reply did to the thread, `null` when it only said something. */
  action: z.enum(REPLY_ACTIONS).nullable(),
  assignee: z.string().nullable(),
})

const threadSchema = z.object({
  comment_id: z.string(),
  status: z.enum(THREAD_STATUSES),
  /** For a spreadsheet, the cell the thread is anchored to (`Plan!B2`, or `Plan!B2:C3` for several cells); `null` when it has none, and for every other file. */
  at: z.string().nullable(),
  /** The text of the file the thread is about, when Google gives it. */
  quote: z.string().nullable(),
  author: z.string().nullable(),
  me: z.boolean(),
  text: z.string(),
  text_clipped: z.boolean(),
  /** When the thread's first comment was last changed, else when it was made. */
  time: z.string().nullable(),
  assignee: z.string().nullable(),
  replies: z.array(replySchema),
})

export const commentsReadOutput = z.object({
  file_id: z.string(),
  name: z.string(),
  kind: z.enum(FILE_KINDS),
  web_view_link: z.string().nullable(),
  comments: z.array(threadSchema),
  /** How many resolved threads were left out because `resolved` was not true. */
  resolved_hidden: z.number().int(),
  /** How many matching threads are beyond `limit`. */
  more: z.number().int(),
  /** For a file that is not a spreadsheet: `true` when the read stopped after `MAX_DRIVE_PAGES` pages with threads left, so the counts are lower bounds. */
  incomplete: z.boolean(),
})

export type CommentsReadArgs = z.output<typeof commentsReadInput>
export type CommentsReadResult = z.infer<typeof commentsReadOutput>
export type CommentThread = z.infer<typeof threadSchema>
export type CommentReply = z.infer<typeof replySchema>
