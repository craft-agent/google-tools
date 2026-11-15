import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { CLIENT_SECRET, REFRESH_TOKEN } from "../core/google/client.fixtures"
import { fakeGoogle } from "../core/google/fake-google.testing"
import { stateRoot } from "../core/google/labels"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "./command-io"
import {
  STATE_DIR_FLAG,
  leaks,
  removeTempDirs,
  runCommand,
  signedInAccount,
  tempDir,
  type CommandRun,
} from "./commands.testing"
import { runRemoveCommand } from "./remove"

afterEach(removeTempDirs)

const REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const MUST_NOT_ASK = async (): Promise<never> => {
  throw new Error("must not prompt")
}

/** A Google that accepts every revoke, and what it was asked. */
function acceptingGoogle() {
  return fakeGoogle([{ method: "POST", url: REVOKE_URL, reply: { status: 200 } }])
}

function remove(argv: string[], overrides: Parameters<typeof runCommand>[2] = {}): Promise<CommandRun> {
  return runCommand(runRemoveCommand, argv, overrides)
}

async function labelsIn(stateDir: string): Promise<string[]> {
  return (await readdir(stateRoot(stateDir).accounts)).sort()
}

describe("remove confirmation", () => {
  test("--yes revokes the token and removes only the selected label, without asking", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other")
    const google = acceptingGoogle()

    const run = await remove(["--account=work", "--yes", `${STATE_DIR_FLAG}=${stateDir}`], {
      isTTY: false,
      readLine: MUST_NOT_ASK,
      fetch: google.fetch,
    })

    expect(run.code).toBe(EXIT_OK)
    expect(await labelsIn(stateDir)).toEqual(["other"])
    expect(run.stdout).toBe('Removed "work": its token is revoked at Google and its local state is deleted.\n')
    expect(google.requests).toHaveLength(1)
    expect(google.requests[0]!.form).toEqual({ token: REFRESH_TOKEN })
    expect(leaks(run, [REFRESH_TOKEN, CLIENT_SECRET])).toBe(false)
  })

  test("a terminal confirms by typing the exact label, after being told what goes", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    const prompts: string[] = []
    const google = acceptingGoogle()

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      fetch: google.fetch,
      readLine: async (prompt) => {
        prompts.push(prompt)
        return "work"
      },
    })

    expect(run.code).toBe(EXIT_OK)
    expect(prompts).toEqual(['To confirm, type the label "work": '])
    expect(run.stderr).toContain(dir)
    expect(run.stderr).toContain("revoke the token")
    expect(await labelsIn(stateDir)).toEqual([])
  })

  test.each(["other", " work ", "", undefined])(
    "the answer %j cancels, revokes nothing and keeps the state",
    async (answer) => {
      const stateDir = await tempDir()
      const dir = await signedInAccount(stateDir, "work")
      const google = acceptingGoogle()

      const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
        isTTY: true,
        fetch: google.fetch,
        readLine: async () => answer,
      })

      expect(run.code).toBe(EXIT_FAILED)
      expect(run.stdout).toBe("")
      expect(run.stderr).toContain("Removal cancelled.")
      expect(await readdir(dir)).toContain("credentials.json")
      expect(google.requests).toHaveLength(0)
    },
  )

  test("without a terminal and without --yes it is a usage error and keeps the state", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
      isTTY: false,
      readLine: MUST_NOT_ASK,
      fetch: MUST_NOT_ASK,
    })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toBe("google-tools-cli: Removing a Google account without a terminal requires --yes.\n")
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })

  test("a label that is not there fails before anything is asked or revoked", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove(["--account", "gone", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      readLine: MUST_NOT_ASK,
      fetch: MUST_NOT_ASK,
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain('Google account "gone" was not found')
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })

  test.each(["before", "during"])(
    "cancelling %s the confirmation keeps the state and revokes nothing",
    async (when) => {
      const stateDir = await tempDir()
      await signedInAccount(stateDir, "work")
      const controller = new AbortController()
      if (when === "before") controller.abort()

      const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
        isTTY: true,
        signal: controller.signal,
        fetch: MUST_NOT_ASK,
        readLine: async () => {
          controller.abort()
          return "work"
        },
      })

      expect(run.code).toBe(EXIT_FAILED)
      expect(run.stderr).toContain("Cancelled.")
      expect(await labelsIn(stateDir)).toEqual(["work"])
    },
  )
})

describe("remove refusals", () => {
  test("a label directory that is a symlink is refused and its target is left alone", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "other")
    const target = join(await tempDir(), "target")
    await mkdir(target)
    await writeFile(join(target, "keep"), "x")
    await symlink(target, join(stateRoot(stateDir).accounts, "work"))

    const run = await remove(["--account", "work", "--yes", STATE_DIR_FLAG, stateDir], { fetch: MUST_NOT_ASK })

    expect(run.code).toBe(EXIT_FAILED)
    expect(await readdir(target)).toEqual(["keep"])
    expect(await labelsIn(stateDir)).toEqual(["other", "work"])
  })

  test.each(
    [
      [],
      ["--yes"],
      ["--account"],
      ["--account="],
      ["--account", "Bad"],
      ["--account", CLIENT_SECRET],
      ["--account", "work", "--yes=true"],
      ["--account", "work", "--nope"],
      ["--account", "work", "extra"],
    ].map((args): [string[]] => [args]),
  )("invalid arguments %j are a usage error with no effect", async (argv) => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove([...argv, `${STATE_DIR_FLAG}=${stateDir}`], {
      isTTY: true,
      readLine: MUST_NOT_ASK,
      fetch: MUST_NOT_ASK,
    })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stdout).toBe("")
    expect(leaks(run, [CLIENT_SECRET])).toBe(false)
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })
})
