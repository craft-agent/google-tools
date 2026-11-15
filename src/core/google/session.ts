import { requireRuntime, type ToolRuntime } from "../runtime"
import { GoogleClient } from "./client"
import { credentialVariable } from "./credentials"
import { pickLabel } from "./labels"

/** What a tool that calls Google works with: the runtime and state directory, the label it picked and the client for that label. */
export type GoogleSession = {
  runtime: ToolRuntime
  stateDir: string
  label: string
  client: GoogleClient
}

/**
 * Picks the label `account` names (see `pickLabel`) and builds the client that
 * calls Google as it. `subject` says what needs the runtime when the call has
 * none (`internal_error`: "<subject> require a runtime and an absolute state
 * directory."). The credential is read by the client's first request, so
 * nothing here contacts Google.
 */
export async function googleSession(
  ctx: { runtime?: ToolRuntime; stateDir?: string; signal?: AbortSignal },
  account: string | undefined,
  subject: string,
): Promise<GoogleSession> {
  const { runtime, stateDir } = requireRuntime(ctx, subject)
  const paths = await pickLabel(stateDir, account)
  const client = new GoogleClient({
    paths,
    variable: credentialVariable(runtime.envPrefix, paths.label),
    env: runtime.env,
    fetch: runtime.fetch,
    now: runtime.now,
    signal: ctx.signal,
  })
  return { runtime, stateDir, label: paths.label, client }
}
