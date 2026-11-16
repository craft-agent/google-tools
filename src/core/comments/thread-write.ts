import { z } from "zod"
import type { GoogleClient, RequestOptions } from "../google/client"
import type { Route } from "../google/routes"
import { parseReply } from "../sheets/reply"
import { COMMENTS_ROUTES } from "./routes"
import type { ThreadPlan } from "./thread-plan"
import { commentRefusal, requireSaved } from "./write-guards"

/** The `fields` of a Drive write whose answer is not used but which Google asks to name them: only the id. */
export const ID_FIELDS = "id"

/** What Google's refusal of a write on another file comes down to. */
const DRIVE_FILE_ONLY =
  "these tools can change comments only on spreadsheets and on the files they created (drive.file)"

/** The path parameters of a Drive route on the thread, or on the reply the plan names. */
export function postParams({ file, thread, reply }: Pick<ThreadPlan, "file" | "thread" | "reply">) {
  return {
    file_id: file.fileId,
    comment_id: thread.commentId,
    ...(reply !== null && { reply_id: reply.postId }),
  }
}

/** `spreadsheets.batchUpdate`'s answer to a comment request; only the state of the change is used. */
const batchState = z.object({ commentUpdateState: z.string().optional() })

/** Sends `request` as the one request of a spreadsheet's batch update; any state of the batch but `ALL_SAVED` is `upstream_error`, since the change may or may not have been made. */
export async function sendSheetsRequest(
  { client, file }: Pick<ThreadPlan, "client" | "file">,
  request: Record<string, unknown>,
): Promise<void> {
  const reply = parseReply(
    batchState,
    await client.request(COMMENTS_ROUTES.batchUpdate, {
      params: { spreadsheet_id: file.fileId },
      body: { requests: [request] },
    }),
    "the change",
  )
  requireSaved(reply.commentUpdateState, "the change", "It may or may not have been made")
}

/**
 * Sends one write of a file that is not a spreadsheet; Google's answer is not
 * used. A 403 or a 404 is `forbidden`, saying Google refused to `what`
 * (`edit the comment`), since the plan read the file and drive.file lets these
 * tools change only the files they made; any other failure passes as it is.
 */
export async function sendDriveRequest(
  client: GoogleClient,
  route: Route,
  options: RequestOptions,
  what: string,
): Promise<void> {
  try {
    await client.request(route, options)
  } catch (error) {
    throw commentRefusal(error, `Google refused to ${what}: ${DRIVE_FILE_ONLY}, and nothing was changed.`) ?? error
  }
}
