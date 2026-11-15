import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CLIENT_ID, TOKEN_URL, USERINFO_URL } from "../google/client.fixtures"
import { credentialVariable, writeCredential, type Credential } from "../google/credentials"
import { fakeGoogle, tokenReply, type FakeHandler } from "../google/fake-google.testing"
import { ensureLabelDir, type LabelPaths } from "../google/labels"
import { clearTokenCache } from "../google/token"
import type { ToolRuntime } from "../runtime"
import { invoke, type ToolContext } from "../tool"
import { googleAccountRead } from "./read"

/** Fixtures the account read tests share: a state directory in a fresh temporary directory, a fake Google and a runtime over both. */

/** The package's own variable prefix and command line, as the runtime names them. */
export const ENV_PREFIX = "GT"
export const CLI = "gt-cli"

/** Where the injected clock stands. */
export const NOW = Date.parse("2026-06-01T12:00:00.000Z")

/** The address Google reports for the label unless a test says otherwise. */
export const EMAIL_NOW = "someone@example.test"

export const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }

export const userinfoHandler = (email: string = EMAIL_NOW): FakeHandler => ({
  method: "GET",
  url: USERINFO_URL,
  reply: { json: { sub: "1234567890", email, name: "Someone", client_id: CLIENT_ID } },
})

/** The directories the fixtures made, which `cleanUp` removes. */
const made: string[] = []

/** Removes every state directory the fixtures made; each test file runs it after each test. */
export async function cleanUp(): Promise<void> {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
}

/** Starts every test with no access token cached by an earlier one. */
export const freshTokens = clearTokenCache

/** A state directory, a fake Google answering `handlers` and the tool's context over them. */
export async function fixture(handlers: FakeHandler[] = [tokenHandler, userinfoHandler()]) {
  const stateDir = await mkdtemp(join(tmpdir(), "account-read-"))
  made.push(stateDir)
  const env: Record<string, string | undefined> = {}
  const google = fakeGoogle(handlers)
  const runtime: ToolRuntime = { envPrefix: ENV_PREFIX, cli: CLI, env, fetch: google.fetch, now: () => NOW }
  const ctx: ToolContext = { cwd: stateDir, stateDir, runtime }
  return {
    stateDir,
    env,
    runtime,
    ctx,
    /** What the fake Google received. */
    requests: google.requests,
    /** Makes the label's directory, with `credential` as its credential file when one is given. */
    async label(name: string, credential?: Credential): Promise<LabelPaths> {
      const paths = await ensureLabelDir(stateDir, name)
      if (credential) await writeCredential(paths, credential)
      return paths
    },
    /** Gives the label's variable the text, or the credential as JSON. */
    setVariable(name: string, value: Credential | string): void {
      env[credentialVariable(ENV_PREFIX, name)] = typeof value === "string" ? value : JSON.stringify(value)
    },
    /** Writes the label's credential file with the text and mode given. */
    async writeFile(paths: LabelPaths, text: string, mode = 0o600): Promise<void> {
      await writeFile(paths.credentials, text, { mode })
      await chmod(paths.credentials, mode)
    },
    read: (args: unknown) => invoke(googleAccountRead, args, ctx),
  }
}
