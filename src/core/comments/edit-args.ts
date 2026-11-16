import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_COMMENT_CHARACTERS, MAX_SPREADSHEET_COMMENT_BYTES } from "./add-args"
import { commentsReadInput } from "./schemas"

export const commentsEditInput = z.strictObject({
  account: accountArg,
  file: commentsReadInput.shape.file,
  comment_id: z.string().min(1).describe("The thread: the `comment_id` of `google_comments_read`."),
  reply_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Edits this reply of the thread (the `reply_id` of `google_comments_read`). Left out, the comment's own text.",
    ),
  text: z
    .string()
    .min(1)
    .max(MAX_COMMENT_CHARACTERS)
    .describe(
      `The new words, replacing the old ones: 1 to ${MAX_COMMENT_CHARACTERS} characters of plain text (at most ${MAX_SPREADSHEET_COMMENT_BYTES} bytes in UTF-8 on a spreadsheet). It may not mention an address the old text did not.`,
    ),
})

export const commentsEditOutput = z.object({
  file_id: z.string(),
  comment_id: z.string(),
  /** The id of the edited reply; `null` when the comment's own text was edited. */
  reply_id: z.string().nullable(),
  /** The text that was replaced, cut at the characters the read cuts at. */
  before: z.string(),
  /** The text the post has now. */
  text: z.string(),
})

export type CommentsEditArgs = z.output<typeof commentsEditInput>
export type CommentsEditResult = z.infer<typeof commentsEditOutput>
