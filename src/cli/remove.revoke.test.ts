import { afterEach, describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { CLIENT_SECRET, REFRESH_TOKEN } from "../core/google/client.fixtures"
import { labelPaths } from "../core/google/labels"
import { EXIT_FAILED, EXIT_OK } from "./command-io"
import { STATE_DIR_FLAG, leaks, removeTempDirs, runCommand, signedInAccount, tempDir } from "./commands.testing"
import { runRemoveCommand } from "./remove"
import { SECRETS, removeWith } from "./remove.testing"

afterEach(removeTempDirs)

describe("remove revokes the token", () => {
  test("a reply that the token is invalid counts as already revoked", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run, requests } = await removeWith(stateDir, {
      status: 400,
      json: { error: "invalid_token", error_description: "Token expired or revoked" },
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain('Removed "work"')
    expect(requests).toHaveLength(1)
    expect(await readdir(labelPaths(stateDir, "work").dir).catch(() => "gone")).toBe("gone")
  })

  test.each([
    ["a server error", { status: 503, json: { error: "backend_error" } }],
    ["another bad request", { status: 400, json: { error: "invalid_request" } }],
    ["a refusal", { status: 401, json: { error: "invalid_client" } }],
    ["a reply that echoes the token", { status: 500, text: `broken ${REFRESH_TOKEN} ${CLIENT_SECRET}` }],
  ])("%s stops before anything is deleted and says so", async (_name, reply) => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")

    const { run } = await removeWith(stateDir, reply)

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr).toContain('Nothing was removed; "work" is still set up.')
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await readdir(dir)).toContain("credentials.json")
  })

  test("a Google that cannot be reached stops before anything is deleted", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    const run = await runCommand(runRemoveCommand, ["--account", "work", "--yes", STATE_DIR_FLAG, stateDir], {
      fetch: async () => {
        throw new Error(`connection refused for ${REFRESH_TOKEN}`)
      },
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("Nothing was removed")
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await readdir(dir)).toContain("credentials.json")
  })

  test("a cancellation while revoking keeps the state", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    const controller = new AbortController()
    const run = await runCommand(runRemoveCommand, ["--account", "work", "--yes", STATE_DIR_FLAG, stateDir], {
      signal: controller.signal,
      fetch: async () => {
        controller.abort()
        throw new Error("aborted")
      },
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("Nothing was removed")
    expect(await readdir(dir)).toContain("credentials.json")
  })
})
