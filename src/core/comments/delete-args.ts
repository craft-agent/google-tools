import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { commentsReadInput } from "./schemas"

export const commentsDeleteInput = z.strictObject({
  account: accountArg,
  file: commentsReadInput.shape.file,
  comment_id: z.string().min(1).describe("The thread: the `comment_id` of `google_comments_read`."),
  reply_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Deletes only this reply of the thread (the `reply_id` of `google_comments_read`). Left out, the whole thread goes, with every reply in it.",
    ),
})

export const commentsDeleteOutput = z.object({
  file_id: z.string(),
  comment_id: z.string(),
  /** The id of the deleted reply; `null` when the whole thread was deleted. */
  reply_id: z.string().nullable(),
  /** The text of the deleted comment or reply, cut at the characters the read cuts at. */
  deleted_text: z.string(),
  /** How many live replies went with a deleted thread; 0 for a deleted reply. */
  replies_deleted: z.number().int(),
})

export type CommentsDeleteArgs = z.output<typeof commentsDeleteInput>
export type CommentsDeleteResult = z.infer<typeof commentsDeleteOutput>
