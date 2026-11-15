import { afterEach, describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { CLIENT_SECRET } from "../core/google/client.fixtures"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "./cli"
import { removeTempDirs, signedInAccount, tempDir } from "./commands.testing"
import { cli } from "./testing"

afterEach(removeTempDirs)

describe("the person commands", () => {
  test("the usage line names login and remove", async () => {
    const run = await cli(["bogus"])

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("login [--account <label>] --toolsets <list>")
    expect(run.stderr).toContain("remove --account <label>")
  })

  test("login is dispatched before tool parsing and reads no standard input", async () => {
    const run = await cli(["login", "--account", "work"], "", {
      readStdin: async () => {
        throw new Error("must not read standard input")
      },
    })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("Option --toolsets is required")
    expect(run.stdout).toBe("")
  })

  test("remove is dispatched with the injected fetch and terminal state", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await cli(["remove", "--account", "work", "--yes", "--state-dir", stateDir], "", {
      fetch: async () => new Response("{}", { status: 200 }),
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain('Removed "work"')
    expect(await readdir(`${stateDir}/accounts`)).toEqual([])
  })

  test("a failing person command answers on standard error, not as JSON", async () => {
    const stateDir = await tempDir()

    const run = await cli(["remove", "--account", "absent", "--yes", "--state-dir", stateDir])

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr).toContain('Google account "absent" was not found')
    expect(run.stderr).not.toContain(CLIENT_SECRET)
  })

  test("a person command's own flags are not tool settings", async () => {
    const run = await cli(["login", "--toolsets", "account", "--unattended"])

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("Login accepts only")
  })
})
