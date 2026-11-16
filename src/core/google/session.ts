import { requireRuntime, type ToolRuntime } from "../runtime"
import { GoogleClient } from "./client"
import { credentialVariable, type Credential } from "./credentials"
import { pickLabel } from "./labels"
import { loginCommand } from "./login-command"
import { TOOLSET_SCOPES, grantedToolsets, needsWrite, toolsetsFor } from "./scopes"

/** What a tool that calls Google works with: the runtime and state directory, the label it picked and the client for that label. */
export type GoogleSession = {
  runtime: ToolRuntime
  stateDir: string
  label: string
  client: GoogleClient
}

/**
 * The `login` command that gives the label the scopes a call needs: the
 * toolsets it already holds plus those `needs` belong to, and only reading
 * unless `needs` can be met by writing alone. `toolset` is the calling tool's
 * own, which `toolsetsFor` prefers.
 */
function missingScopeCommand(
  runtime: ToolRuntime,
  stateDir: string,
  label: string,
  needs: readonly string[],
  credential: Credential,
  toolset: string,
): string {
  const granted = grantedToolsets(credential.scopes)
  const wanted = new Set([...granted.toolsets, ...toolsetsFor(needs, toolset)])
  return loginCommand(runtime, stateDir, {
    label,
    toolsets: Object.keys(TOOLSET_SCOPES).filter((name) => wanted.has(name)),
    readOnly: granted.readOnly.length > 0 && !needsWrite(needs),
    needsClient: false,
  })
}

/**
 * Picks the label `account` names (see `pickLabel`) and builds the client that
 * calls Google as it; when the label lacks a route's scopes, the client's error
 * names the `login` command that adds them. `subject` says what needs the
 * runtime when the call has none (`internal_error`: "<subject> require a
 * runtime and an absolute state directory."). `toolset` is the calling tool's
 * own toolset, which the missing-scope fix asks for when it holds a scope the
 * call accepts. The credential is read by the client's first request, so
 * nothing here contacts Google.
 */
export async function googleSession(
  ctx: { runtime?: ToolRuntime; stateDir?: string; signal?: AbortSignal },
  account: string | undefined,
  subject: string,
  toolset: string,
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
    missingScopeFix: (needs, credential) =>
      missingScopeCommand(runtime, stateDir, paths.label, needs, credential, toolset),
  })
  return { runtime, stateDir, label: paths.label, client }
}
