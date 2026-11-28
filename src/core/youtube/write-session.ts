import { abortError } from "../exec"
import type { Route } from "../google/routes"
import { googleSession, type GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { YOUTUBE_TOOLSET } from "./scopes"

/**
 * Picks the label `account` names and checks, before any request, that it
 * holds a scope `write` accepts. The reads a write plans with take
 * `youtube.readonly` too, but `write` takes `youtube.force-ssl` alone, which
 * allows them all, so a label that cannot write is refused before anything is
 * sent.
 */
export async function youtubeWriteSession(
  ctx: ToolContext,
  account: string | undefined,
  write: Route,
): Promise<GoogleSession> {
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const session = await googleSession(ctx, account, "YouTube writes", YOUTUBE_TOOLSET)
  await session.client.requireScopes(write)
  return session
}
