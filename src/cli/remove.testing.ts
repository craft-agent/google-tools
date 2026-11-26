import { CLIENT_SECRET, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN } from "../core/google/client.fixtures"
import { credentialVariable } from "../core/google/credentials"
import { fakeGoogle, type FakeHandler, type FakeReply } from "../core/google/fake-google.testing"
import { PROJECT } from "../project"
import { STATE_DIR_FLAG, runCommand } from "./commands.testing"
import { runRemoveCommand } from "./remove"

/** Fixtures the tests of `remove` share. */

export const REVOKE_URL = "https://oauth2.googleapis.com/revoke"

/** The made-up refresh token of another label. */
export const OTHER_REFRESH_TOKEN = ["madeUpOtherToken", "DDDD1357924680"].join("-")

/** The made-up secrets no output of `remove` may hold. */
export const SECRETS = [REFRESH_TOKEN, ROTATED_REFRESH_TOKEN, OTHER_REFRESH_TOKEN, CLIENT_SECRET]

/** The variable of the label `work`. */
export const VARIABLE = credentialVariable(PROJECT.envPrefix, "work")

/** The variable of the label `other`. */
export const OTHER_VARIABLE = credentialVariable(PROJECT.envPrefix, "other")

/**
 * Runs `remove --yes` for `work`, with Google answering every revoke with
 * `reply` (a function sees the request); `extraArgs` follow the arguments.
 */
export async function removeWith(
  stateDir: string,
  reply: FakeHandler["reply"] | FakeReply,
  env: Record<string, string> = {},
  extraArgs: string[] = [],
) {
  const google = fakeGoogle([{ method: "POST", url: REVOKE_URL, reply }])
  const argv = ["--account", "work", "--yes", STATE_DIR_FLAG, stateDir, ...extraArgs]
  const run = await runCommand(runRemoveCommand, argv, {
    env,
    fetch: google.fetch,
  })
  return { run, requests: google.requests }
}
