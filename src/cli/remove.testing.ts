import { CLIENT_SECRET, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN } from "../core/google/client.fixtures"
import { credentialVariable } from "../core/google/credentials"
import { fakeGoogle, type FakeHandler, type FakeReply } from "../core/google/fake-google.testing"
import { PROJECT } from "../project"
import { STATE_DIR_FLAG, runCommand } from "./commands.testing"
import { runRemoveCommand } from "./remove"

/** Fixtures the tests of `remove` share. */

export const REVOKE_URL = "https://oauth2.googleapis.com/revoke"

/** The made-up secrets no output of `remove` may hold. */
export const SECRETS = [REFRESH_TOKEN, ROTATED_REFRESH_TOKEN, CLIENT_SECRET]

/** The variable of the label `work`. */
export const VARIABLE = credentialVariable(PROJECT.envPrefix, "work")

/** Runs `remove --yes` for `work`, with Google answering every revoke with `reply` (a function sees the request). */
export async function removeWith(
  stateDir: string,
  reply: FakeHandler["reply"] | FakeReply,
  env: Record<string, string> = {},
) {
  const google = fakeGoogle([{ method: "POST", url: REVOKE_URL, reply }])
  const run = await runCommand(runRemoveCommand, ["--account", "work", "--yes", STATE_DIR_FLAG, stateDir], {
    env,
    fetch: google.fetch,
  })
  return { run, requests: google.requests }
}
