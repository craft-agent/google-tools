import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readdir, symlink } from "node:fs/promises"
import { join } from "node:path"
import { CLIENT_SECRET, REFRESH_TOKEN } from "../core/google/client.fixtures"
import { tokenEndpoint } from "../core/google/consent.testing"
import { fakeGoogle } from "../core/google/fake-google.testing"
import { EXIT_FAILED } from "./command-io"
import {
  STATE_DIR_FLAG,
  approvingBrowser,
  clientJson,
  leaks,
  removeTempDirs,
  runCommand,
  tempDir,
  writeClientFile,
} from "./commands.testing"
import { runLoginCommand } from "./login"

afterEach(removeTempDirs)

const MUST_NOT_RUN = async (): Promise<never> => {
  throw new Error("must not run")
}

/** Runs `login` where nothing may reach Google or a browser. */
function loginOffline(argv: string[], stateDir: string) {
  return runCommand(runLoginCommand, [...argv, `${STATE_DIR_FLAG}=${stateDir}`], {
    fetch: MUST_NOT_RUN,
    openBrowser: MUST_NOT_RUN,
  })
}

describe("what login finds while it runs exits 1", () => {
  test("a Web application client is refused with the way to get the right one", async () => {
    const stateDir = await tempDir()
    const client = await writeClientFile(await tempDir(), clientJson("web"))

    const run = await loginOffline(["--toolsets", "account", "--client", client], stateDir)

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("is a Web application client; create a Desktop app client and download its JSON.")
    expect(leaks(run, [CLIENT_SECRET])).toBe(false)
  })

  test("a client file that cannot be read is refused without repeating the path", async () => {
    const stateDir = await tempDir()
    const missing = join(await tempDir(), `missing-${CLIENT_SECRET}.json`)

    const run = await loginOffline(["--toolsets", "account", "--client", missing], stateDir)

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("The file given to --client could not be read (ENOENT).")
    expect(leaks(run, [CLIENT_SECRET])).toBe(false)
  })

  test("a client file that is not JSON is refused without echoing it", async () => {
    const stateDir = await tempDir()
    const client = await writeClientFile(await tempDir(), `{ "installed": ${CLIENT_SECRET}`)

    const run = await loginOffline(["--toolsets", "account", "--client", client], stateDir)

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("is not a Google OAuth client file")
    expect(leaks(run, [CLIENT_SECRET])).toBe(false)
  })

  test("a state directory with a symlink in the way stores nothing and leaves the link's target alone", async () => {
    const stateDir = join(await tempDir(), "state")
    const target = await tempDir()
    await mkdir(stateDir)
    await symlink(target, join(stateDir, "accounts"))
    const google = fakeGoogle([tokenEndpoint()])

    const run = await runCommand(
      runLoginCommand,
      ["--toolsets", "account", "--client", await writeClientFile(await tempDir()), STATE_DIR_FLAG, stateDir],
      { fetch: google.fetch, openBrowser: approvingBrowser },
    )

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("is not a directory")
    expect(leaks(run, [REFRESH_TOKEN, CLIENT_SECRET])).toBe(false)
    expect(await readdir(target)).toEqual([])
  })
})
