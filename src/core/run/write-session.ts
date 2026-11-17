import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { googleSession } from "../google/session"
import type { ToolRuntime } from "../runtime"
import type { ToolContext } from "../tool"
import { RUN_ROUTES } from "./routes"
import { RUN_TOOLSET } from "./scopes"

/** What a Cloud Run write works with: the client of the label it picked, the label's name and the runtime, whose clock a wait reads. */
export type RunWriteSession = { client: GoogleClient; label: string; runtime: ToolRuntime }

/**
 * Picks the label `account` names and checks, before any request, that it
 * holds both scopes a Cloud Run write needs: `write`'s (run) and the read the
 * plan makes (run.readonly).
 */
export async function runWriteSession(
  ctx: ToolContext,
  account: string | undefined,
  write: Route,
): Promise<RunWriteSession> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client, label, runtime } = await googleSession(ctx, account, "Cloud Run writes", RUN_TOOLSET)
  await client.requireScopes(write)
  await client.requireScopes(RUN_ROUTES.service)
  return { client, label, runtime }
}
