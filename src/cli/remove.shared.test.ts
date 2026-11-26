import { afterEach, describe, expect, test } from "bun:test"
import { readFile, readdir, rm } from "node:fs/promises"
import { CLIENT_ID, CREDENTIAL, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN } from "../core/google/client.fixtures"
import type { Credential } from "../core/google/credentials"
import { fakeGoogle } from "../core/google/fake-google.testing"
import { ensureLabelDir, labelPaths } from "../core/google/labels"
import { EXIT_OK } from "./command-io"
import {
  STATE_DIR_FLAG,
  leaks,
  removeTempDirs,
  runCommand,
  signedInAccount,
  tempDir,
  writeCredentialText,
} from "./commands.testing"
import { runRemoveCommand } from "./remove"
import { OTHER_REFRESH_TOKEN, OTHER_VARIABLE, REVOKE_URL, SECRETS, VARIABLE, removeWith } from "./remove.testing"

afterEach(removeTempDirs)

const OTHER_CREDENTIAL: Credential = { ...CREDENTIAL, refresh_token: OTHER_REFRESH_TOKEN }
const VARIABLE_CREDENTIAL: Credential = { ...CREDENTIAL, refresh_token: ROTATED_REFRESH_TOKEN }
const OTHER_EMAIL = "another@example.test"

const NOT_REVOKED_BECAUSE_OTHER =
  'its token is not revoked at Google, because "other" uses the same OAuth client for the same Google account and would be logged out too. The token stays valid at Google until the last such label is removed.'

async function gone(stateDir: string, label = "work"): Promise<boolean> {
  return (await readdir(labelPaths(stateDir, label).dir).catch(() => "gone")) === "gone"
}

/** Runs `remove` for `work` as a person at a terminal who types `work`; what was said on standard error is in the run. */
async function removeConfirmed(stateDir: string, extraArgs: string[] = []) {
  const google = fakeGoogle([{ method: "POST", url: REVOKE_URL, reply: { status: 200 } }])
  const run = await runCommand(runRemoveCommand, ["--account", "work", STATE_DIR_FLAG, stateDir, ...extraArgs], {
    isTTY: true,
    readLine: async () => "work",
    fetch: google.fetch,
  })
  return { run, requests: google.requests }
}

describe("remove of a label whose grant another label shares", () => {
  test("the same client and email keep the token valid, and only the state of the label goes", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    const otherDir = await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)
    const otherFile = labelPaths(stateDir, "other").credentials
    const before = await readFile(otherFile, "utf8")

    const { run, requests } = await removeWith(stateDir, { status: 200 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stdout).toBe(`Removed "work": its local state is deleted; ${NOT_REVOKED_BECAUSE_OTHER}\n`)
    expect(run.stderr).toBe("")
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
    expect(await readdir(otherDir)).toContain("credentials.json")
    expect(await readFile(otherFile, "utf8")).toBe(before)
  })

  test.each([
    ["another client", { ...OTHER_CREDENTIAL, client_id: `other-${CLIENT_ID}` }, false],
    ["the same client and another email", { ...OTHER_CREDENTIAL, email: OTHER_EMAIL }, false],
    ["the same client and no email in the other", { ...OTHER_CREDENTIAL, email: null }, true],
  ])("%s: kept is %p", async (_name, other, isKept) => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", other)

    const { run, requests } = await removeWith(stateDir, { status: 200 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(isKept ? 0 : 1)
    expect(run.stdout.includes("is not revoked")).toBe(isKept)
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
  })

  test("a label with no email shares with a label that has one", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work", { ...CREDENTIAL, email: null })
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)

    const { run, requests } = await removeWith(stateDir, { status: 200 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stdout).toContain(NOT_REVOKED_BECAUSE_OTHER)
  })

  test("the other label's credential only in its variable counts", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await ensureLabelDir(stateDir, "other")

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [OTHER_VARIABLE]: JSON.stringify(OTHER_CREDENTIAL) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stdout).toContain(NOT_REVOKED_BECAUSE_OTHER)
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("the other label's credential that cannot be read is not counted and not mentioned", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await writeCredentialText(stateDir, "other", `{ "refresh_token": "${OTHER_REFRESH_TOKEN}"`)

    const { run, requests } = await removeWith(stateDir, { status: 200 })

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: REFRESH_TOKEN }])
    expect(run.stdout).toBe('Removed "work": its token is revoked at Google and its local state is deleted.\n')
    expect(run.stderr).toBe("")
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("the other label's variable that cannot be read is not counted either", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await ensureLabelDir(stateDir, "other")

    const { run, requests } = await removeWith(stateDir, { status: 200 }, { [OTHER_VARIABLE]: "not a credential" })

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(1)
    expect(run.stderr).toBe("")
  })

  test("several labels are named in turn", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "a", OTHER_CREDENTIAL)
    await signedInAccount(stateDir, "b", { ...OTHER_CREDENTIAL, email: null })
    await signedInAccount(stateDir, "c", { ...OTHER_CREDENTIAL, email: OTHER_EMAIL })

    const { run, requests } = await removeWith(stateDir, { status: 200 })

    expect(requests).toHaveLength(0)
    expect(run.stdout).toContain(
      '"a" and "b" use the same OAuth client for the same Google account and would be logged out too.',
    )
  })
})

describe("remove --revoke of a label whose grant another label shares", () => {
  test("revokes the token and says which label is logged out and how to log it in again", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)

    const { run, requests } = await removeWith(stateDir, { status: 200 }, {}, ["--revoke"])

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: REFRESH_TOKEN }])
    expect(run.stdout).toBe(
      'Removed "work": its token is revoked at Google and its local state is deleted.\n' +
        '"other" used the same OAuth client for the same Google account, so it is logged out too; log it in again with login --account <label> --toolsets <list>.\n',
    )
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await gone(stateDir)).toBe(true)
  })

  test("names several labels", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "b", OTHER_CREDENTIAL)
    await signedInAccount(stateDir, "a", OTHER_CREDENTIAL)

    const { run } = await removeWith(stateDir, { status: 200 }, {}, ["--revoke"])

    expect(run.stdout).toContain(
      '"a" and "b" used the same OAuth client for the same Google account, so they are logged out too; log each in again with login --account <label> --toolsets <list>.\n',
    )
  })

  test("changes nothing when no label shares the grant", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", { ...OTHER_CREDENTIAL, client_id: `other-${CLIENT_ID}` })

    const { run, requests } = await removeWith(stateDir, { status: 200 }, {}, ["--revoke"])

    expect(requests).toHaveLength(1)
    expect(run.stdout).toBe('Removed "work": its token is revoked at Google and its local state is deleted.\n')
  })
})

describe("remove of a label with several credentials, one of them sharing a grant", () => {
  test("the variable that is kept still works at Google", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await rm(labelPaths(stateDir, "work").credentials)
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)

    const { run, requests } = await removeWith(stateDir, { status: 200 }, { [VARIABLE]: JSON.stringify(CREDENTIAL) })

    expect(requests).toHaveLength(0)
    expect(run.stdout).toBe(
      `Removed "work": its local state is deleted; ${NOT_REVOKED_BECAUSE_OTHER}\n` +
        `Clear ${VARIABLE} where it is set; the token in it still works at Google.\n`,
    )
  })

  test("a credential that shares with a kept one is kept too, even from another email", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work", { ...CREDENTIAL, email: null })
    await signedInAccount(stateDir, "other", { ...OTHER_CREDENTIAL, email: OTHER_EMAIL })

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
    )

    expect(requests).toHaveLength(0)
    expect(run.stdout).toContain(
      'its tokens are not revoked at Google, because "other" uses the same OAuth client for the same Google account and would be logged out too. The tokens stay valid at Google until the last such label is removed.',
    )
    expect(run.stdout).toContain(`Clear ${VARIABLE} where it is set; the token in it still works at Google.`)
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("a credential on another grant is revoked while the other is kept", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify({ ...VARIABLE_CREDENTIAL, client_id: `other-${CLIENT_ID}` }) },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(requests.map((request) => request.form)).toEqual([{ token: ROTATED_REFRESH_TOKEN }])
    expect(run.stdout).toBe(
      'Removed "work": its token is revoked at Google and its local state is deleted; its other token is not revoked at Google, because "other" uses the same OAuth client for the same Google account and would be logged out too. The token stays valid at Google until the last such label is removed.\n' +
        `Clear ${VARIABLE} where it is set; the token in it no longer works.\n`,
    )
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("--revoke revokes them all", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work", { ...CREDENTIAL, email: null })
    await signedInAccount(stateDir, "other", { ...OTHER_CREDENTIAL, email: OTHER_EMAIL })

    const { run, requests } = await removeWith(
      stateDir,
      { status: 200 },
      { [VARIABLE]: JSON.stringify(VARIABLE_CREDENTIAL) },
      ["--revoke"],
    )

    expect(requests.map((request) => request.form)).toEqual([
      { token: ROTATED_REFRESH_TOKEN },
      { token: REFRESH_TOKEN },
    ])
    expect(run.stdout).toContain('"other" used the same OAuth client')
    expect(run.stdout).toContain(`Clear ${VARIABLE} where it is set; the token in it no longer works.`)
  })
})

describe("remove tells what happens at Google before it asks", () => {
  test("a kept token is said, with how to revoke it anyway, and nothing is asked of Google", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)

    const { run, requests } = await removeConfirmed(stateDir)

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(0)
    expect(run.stderr).toBe(
      `This will permanently delete the local state of "work" in ${labelPaths(stateDir, "work").dir}: its credential file and its lock. ` +
        'Its token is not revoked at Google, because "other" uses the same OAuth client for the same Google account and would be logged out too; it stays valid there until the last such label is removed. ' +
        "To revoke it anyway, cancel and run remove with --revoke.\n",
    )
  })

  test("--revoke says which labels the revocation logs out", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "a", OTHER_CREDENTIAL)
    await signedInAccount(stateDir, "b", OTHER_CREDENTIAL)

    const { run, requests } = await removeConfirmed(stateDir, ["--revoke"])

    expect(run.code).toBe(EXIT_OK)
    expect(requests).toHaveLength(1)
    expect(run.stderr).toBe(
      'This will revoke the token of "work" at Google, which also logs out "a" and "b": they use the same OAuth client for the same Google account. ' +
        `It will then permanently delete the local state of "work" in ${labelPaths(stateDir, "work").dir}: its credential file and its lock.\n`,
    )
  })

  test("a label that shares nothing is told as before", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")

    const { run } = await removeConfirmed(stateDir)

    expect(run.stderr).toBe(
      `This will revoke the token of "work" at Google and permanently delete its local state in ${dir}: its credential file and its lock.\n`,
    )
  })

  test("a label with no credential is told it has nothing to revoke", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await rm(labelPaths(stateDir, "work").credentials)

    const { run } = await removeConfirmed(stateDir)

    expect(run.stderr).toBe(
      `google-tools-cli: "work" has no credential, so nothing could be revoked at Google.\n` +
        `This will permanently delete the local state of "work" in ${labelPaths(stateDir, "work").dir}: its credential file and its lock. It has no credential to revoke at Google.\n`,
    )
  })

  test("a refusal keeps the state and revokes nothing", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other", OTHER_CREDENTIAL)
    const google = fakeGoogle([{ method: "POST", url: REVOKE_URL, reply: { status: 200 } }])

    const run = await runCommand(runRemoveCommand, ["--account", "work", "--revoke", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      readLine: async () => "no",
      fetch: google.fetch,
    })

    expect(run.code).not.toBe(EXIT_OK)
    expect(run.stderr).toContain("Removal cancelled.")
    expect(google.requests).toHaveLength(0)
    expect(await gone(stateDir)).toBe(false)
    expect(leaks(run, SECRETS)).toBe(false)
  })
})
