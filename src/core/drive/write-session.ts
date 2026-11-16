import { ToolError, isToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { DRIVE_ROUTES } from "./routes"

/** What a Drive write names its work as when a call has no runtime. */
const DRIVE_WRITES = "Drive writes"

/** What a refusal of Google says is left unchanged when one item alone is changed. */
export const NOTHING_CHANGED = "nothing was changed"

const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404

/** What a Drive write works with: the client of the label it picked and the label's name. */
export type DriveWriteSession = { client: GoogleClient; label: string }

/**
 * Picks the label `account` names and checks, before any request, that it
 * holds both scopes a Drive write needs: `write`'s (drive.file) and the read
 * the plan makes (drive.readonly).
 */
export async function driveWriteSession(
  ctx: ToolContext,
  account: string | undefined,
  write: Route,
): Promise<DriveWriteSession> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label } = await googleSession(ctx, account, DRIVE_WRITES)
  await client.requireScopes(write)
  await client.requireScopes(DRIVE_ROUTES.file)
  return { client, label }
}

/**
 * The `forbidden` error for a write Google refused with a 403 or a 404 on an
 * item the plan had read: drive.file lets these tools change only what they
 * created or a person opened with them, and Google words the rest as either.
 * `unchanged` says what was left as it was. A rate limit and any other failure
 * give `undefined`.
 */
export function driveRefusal(error: unknown, unchanged: string = NOTHING_CHANGED): ToolError | undefined {
  if (!isToolError(error) || error.code === "rate_limited") return undefined
  const status = error.details?.status
  if (status !== HTTP_FORBIDDEN && status !== HTTP_NOT_FOUND) return undefined
  return new ToolError(
    "forbidden",
    `Google refused the change: these tools can change only the files and folders they created (drive.file), and ${unchanged}.`,
    { cause: error, details: { status } },
  )
}

/** Runs one write; a refusal that `driveRefusal` tells is thrown as that, any other failure as it is. */
export async function refusedWrite<T>(write: () => Promise<T>, unchanged?: string): Promise<T> {
  try {
    return await write()
  } catch (error) {
    throw driveRefusal(error, unchanged) ?? error
  }
}
