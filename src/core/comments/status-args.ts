import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { THREAD_STATUSES, commentsReadInput } from "./schemas"

export const commentsStatusInput = z.strictObject({
  account: accountArg,
  file: commentsReadInput.shape.file,
  comment_id: z.string().min(1).describe("The thread to change: the `comment_id` of `google_comments_read`."),
  status: z
    .enum(THREAD_STATUSES)
    .describe(
      "`resolved` resolves the thread, `open` reopens it. A thread that has this status already is not touched.",
    ),
})

export const commentsStatusOutput = z.object({
  file_id: z.string(),
  comment_id: z.string(),
  /** The status the thread has now. */
  status: z.enum(THREAD_STATUSES),
  /** The status it had when the call read it. */
  before: z.enum(THREAD_STATUSES),
  /** `false` when the thread had this status already and nothing was sent. */
  changed: z.boolean(),
})

export type CommentsStatusArgs = z.output<typeof commentsStatusInput>
export type CommentsStatusResult = z.infer<typeof commentsStatusOutput>
