import { z } from "zod"
import { EMAIL_PATTERN, MAX_EMAIL_LENGTH } from "../email"
import { accountArg } from "../sheets/schemas"
import { commentsReadInput } from "./schemas"

/** The most characters of a comment's text. */
export const MAX_COMMENT_CHARACTERS = 2048

/** The most bytes, in UTF-8, of the text of a spreadsheet's comment, which Google counts in code units. */
export const MAX_SPREADSHEET_COMMENT_BYTES = 2048

export const commentsAddInput = z.strictObject({
  account: accountArg,
  file: commentsReadInput.shape.file,
  text: z
    .string()
    .min(1)
    .max(MAX_COMMENT_CHARACTERS)
    .describe(
      `The comment's words, 1 to ${MAX_COMMENT_CHARACTERS} characters of plain text (at most ${MAX_SPREADSHEET_COMMENT_BYTES} bytes in UTF-8 on a spreadsheet). \`+name@example.com\` mentions that address, and Google emails it.`,
    ),
  cell: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Spreadsheets only, for a new comment: the one cell to attach it to, in A1 notation (`Plan!B2`, or `B2` for the first tab). Never together with `comment_id`.",
    ),
  comment_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Replies to this thread instead of starting one: the `comment_id` of `google_comments_read`. Never together with `cell`.",
    ),
  assignee: z
    .string()
    .trim()
    .toLowerCase()
    .max(MAX_EMAIL_LENGTH)
    .regex(EMAIL_PATTERN, "An assignee is a plain email address, such as `name@example.com`.")
    .optional()
    .describe(
      "Spreadsheets only: assigns the thread to this plain address, which Google emails. On a reply it reassigns a thread that is assigned already.",
    ),
})

export const commentsAddOutput = z.object({
  file_id: z.string(),
  /** The thread; empty when Google did not report the id of a new one. */
  comment_id: z.string(),
  /** The id of the reply; `null` for a new thread, and when Google did not report it. */
  reply_id: z.string().nullable(),
  /** The cell of a spreadsheet's new comment, or the one the replied thread is anchored to; `null` for any other file. */
  at: z.string().nullable(),
  assignee: z.string().nullable(),
  /** The addresses Google emails because of the call: the assignee and the ones the text mentions. */
  emailed: z.array(z.string()),
})

export type CommentsAddArgs = z.output<typeof commentsAddInput>
export type CommentsAddResult = z.infer<typeof commentsAddOutput>
