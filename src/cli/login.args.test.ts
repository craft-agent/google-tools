import { afterEach, describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { CLIENT_SECRET, REFRESH_TOKEN } from "../core/google/client.fixtures"
import { EXIT_USAGE } from "./command-io"
import { STATE_DIR_FLAG, leaks, removeTempDirs, runCommand, tempDir, writeClientFile } from "./commands.testing"
import { runLoginCommand } from "./login"

afterEach(removeTempDirs)

const MUST_NOT_RUN = async (): Promise<never> => {
  throw new Error("must not run")
}

/** Runs `login` where nothing may reach Google or a browser. */
function login(argv: string[], stateDir: string, env: Record<string, string> = {}) {
  return runCommand(runLoginCommand, [...argv, `${STATE_DIR_FLAG}=${stateDir}`], {
    env,
    fetch: MUST_NOT_RUN,
    openBrowser: MUST_NOT_RUN,
  })
}

describe("login arguments", () => {
  test("--toolsets is required and the known toolsets are listed", async () => {
    const stateDir = await tempDir()

    const run = await login(["--client", await writeClientFile(await tempDir())], stateDir)

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("Option --toolsets is required; known toolsets: account, sheets.")
    expect(await readdir(stateDir)).toEqual([])
  })

  test.each([
    ["an unknown toolset", ["--toolsets", "account,nope"]],
    ["only blanks", ["--toolsets", " , "]],
    ["an unknown flag", ["--toolsets", "account", "--unknown"]],
    ["a stray word", ["--toolsets", "account", "work"]],
    ["a secret as a stray word", ["--toolsets", "account", REFRESH_TOKEN]],
    ["an invalid label", ["--toolsets", "account", "--account", "Work"]],
    ["a secret as the label", ["--toolsets", "account", "--account", CLIENT_SECRET]],
    ["a secret as the toolset", ["--toolsets", CLIENT_SECRET]],
    ["a flag without a value", ["--toolsets"]],
    ["a switch with a value", ["--toolsets", "account", "--read-only=yes"]],
  ])("%s is a usage error that reads and stores nothing and echoes nothing", async (_name, argv) => {
    const stateDir = await tempDir()

    const run = await login(argv, stateDir)

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stdout).toBe("")
    expect(leaks(run, [REFRESH_TOKEN, CLIENT_SECRET])).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })

  test("a new label needs --client", async () => {
    const stateDir = await tempDir()

    const run = await login(["--toolsets", "account"], stateDir)

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("Option --client <file> is needed for a new label")
    expect(await readdir(stateDir)).toEqual([])
  })
})
