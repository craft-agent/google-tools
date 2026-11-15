import { afterEach, describe, expect, test } from "bun:test"
import { readdir, rm } from "node:fs/promises"
import { CREDENTIAL, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN } from "../core/google/client.fixtures"
import { labelPaths } from "../core/google/labels"
import { EXIT_FAILED, EXIT_OK } from "./command-io"
import { leaks, removeTempDirs, signedInAccount, tempDir, writeCredentialText } from "./commands.testing"
import { SECRETS, VARIABLE, removeWith } from "./remove.testing"

afterEach(removeTempDirs)

const VARIABLE_CREDENTIAL = { ...CREDENTIAL, refresh_token: ROTATED_REFRESH_TOKEN }

async function gone(stateDir: string): Promise<boolean> {
  return (await readdir(labelPaths(stateDir, "work").dir).catch(() => "gone")) === "gone"
}

describe("remove of a label with a variable and a file", () => {
  test("two distinct tokens are both revoked, the variable's first, then the label is removed", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([
      { token: ROTATED_REFRESH_TOKEN },
      { token: REFRESH_TOKEN },
    ])
    expect(run.stdout).toBe(
      `Removed "work": its tokens are revoked at Google and its local state is deleted.\nClear ${VARIABLE} where it is set; the token in it no longer works.\n`,
    )
    expect(run.stderr).toBe("")
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
  })

  test("the same token in both is revoked once", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run, requests } = await removeWith(stateDir, { status: 200 }, { [VARIABLE]: JSON.stringify(CREDENTIAL) })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.form).toEqual({ token: REFRESH_TOKEN })
    expect(run.stdout).toContain("its token is revoked at Google")
    expect(run.stdout).toContain(`Clear ${VARIABLE} where it is set; the token in it no longer works.`)
  })

  test("only a variable, with no file, is revoked and cleared without a note", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await rm(labelPaths(stateDir, "work").credentials)

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: ROTATED_REFRESH_TOKEN }])
    expect(run.stderr).toBe("")
  })

  test("an invalid variable and a valid file: the file is revoked and the variable is noted", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run, requests } = await removeWith(stateDir, { status: 200 }, { [VARIABLE]: `{ "refresh_token": "x"` })

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: REFRESH_TOKEN }])
    expect(run.stderr).toContain(`The credential in ${VARIABLE} could not be read, so its token was not revoked`)
    expect(run.stdout).toBe(
      `Removed "work": its token is revoked at Google and its local state is deleted.\nClear ${VARIABLE} where it is set.\n`,
    )
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
  })

  test("a valid variable and an invalid file: the variable is revoked and the file is noted", async () => {
    const stateDir = await tempDir()
    await writeCredentialText(stateDir, "work", `{ "refresh_token": "${REFRESH_TOKEN}"`)

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: ROTATED_REFRESH_TOKEN }])
    expect(run.stderr).toContain("The credential file")
    expect(run.stderr).toContain("could not be read, so its token was not revoked")
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("a failure on the second token stops before anything is deleted", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    let calls = 0

    const { run, requests } = await removeWith(
      stateDir,
      () => (++calls === 1 ? { status: 200 } : { status: 503, json: { error: "backend_error" } }),
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_FAILED)
    expect(requests).toHaveLength(2)
    expect(run.stdout).toBe("")
    expect(run.stderr).toContain('Nothing was removed; "work" is still set up.')
    expect(await readdir(dir)).toContain("credentials.json")
  })

  test("a token that is already revoked does not stop the other", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    let calls = 0

    const { run, requests } = await removeWith(
      stateDir,
      () => (++calls === 1 ? { status: 400, json: { error: "invalid_token" } } : { status: 200 }),
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(2)
    expect(await gone(stateDir)).toBe(true)
  })
})

describe("remove of a credential that cannot be read", () => {
  test.each([
    ["a file that is not JSON", `{ "refresh_token": "${REFRESH_TOKEN}"`],
    ["a file that is not a credential", JSON.stringify({ refresh_token: REFRESH_TOKEN })],
  ])("%s is removed locally with a note that its token was not revoked", async (_name, text) => {
    const stateDir = await tempDir()
    await writeCredentialText(stateDir, "work", text)

    const { run, requests } = await removeWith(stateDir, { status: 500 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stderr).toContain("could not be read, so its token was not revoked")
    expect(run.stdout).toBe('Removed "work": its local state is deleted; nothing could be revoked at Google.\n')
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
  })

  test("a label with no credential at all is removed locally the same way", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await rm(labelPaths(stateDir, "work").credentials)

    const { run, requests } = await removeWith(stateDir, { status: 500 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stderr).toContain('"work" has no credential, so nothing could be revoked at Google.')
    expect(run.stdout).toBe('Removed "work": its local state is deleted; nothing could be revoked at Google.\n')
  })
})
