import { afterEach, describe, expect, test } from "bun:test"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import {
  CLIENT_ID,
  CLIENT_SECRET,
  CREDENTIAL,
  REFRESH_TOKEN,
  ROTATED_REFRESH_TOKEN,
} from "../core/google/client.fixtures"
import { AUTH_CODE, EMAIL, idToken, tokenEndpoint, visit } from "../core/google/consent.testing"
import { parseCredential, credentialVariable } from "../core/google/credentials"
import { fakeGoogle } from "../core/google/fake-google.testing"
import { labelPaths } from "../core/google/labels"
import { EMAIL_SCOPE, OPENID_SCOPE } from "../core/google/routes"
import { PROJECT } from "../project"
import { EXIT_OK } from "./command-io"
import {
  STATE_DIR_FLAG,
  approvingBrowser,
  leaks,
  removeTempDirs,
  runCommand,
  signedInAccount,
  tempDir,
  writeClientFile,
  type CommandRun,
} from "./commands.testing"
import { runLoginCommand } from "./login"

afterEach(removeTempDirs)

const SECRETS = [REFRESH_TOKEN, ROTATED_REFRESH_TOKEN, CLIENT_SECRET, AUTH_CODE]
const ACCOUNT_SCOPES = [EMAIL_SCOPE, OPENID_SCOPE].sort()
const MUST_NOT_RUN = async (): Promise<never> => {
  throw new Error("must not run")
}

type Session = { run: CommandRun; opened: string[]; requests: ReturnType<typeof fakeGoogle>["requests"] }

/** Runs `login` against a fake Google whose browser approves the consent. */
async function login(
  argv: string[],
  options: { reply?: Record<string, unknown>; env?: Record<string, string> } = {},
): Promise<Session> {
  const google = fakeGoogle([tokenEndpoint(options.reply)])
  const opened: string[] = []
  const run = await runCommand(runLoginCommand, argv, {
    env: options.env ?? {},
    fetch: google.fetch,
    openBrowser: async (url) => {
      opened.push(url)
      await approvingBrowser(url)
    },
  })
  return { run, opened, requests: google.requests }
}

describe("login of a new label", () => {
  test("stores the credential with mode 600 holding exactly the scopes of the toolsets", async () => {
    const stateDir = await tempDir()
    const client = await writeClientFile(await tempDir())

    const { run } = await login([
      "--account",
      "work",
      "--toolsets",
      "account",
      "--client",
      client,
      STATE_DIR_FLAG,
      stateDir,
    ])

    const paths = labelPaths(stateDir, "work")
    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toBe(`Logged in "work" as ${EMAIL}: 2 scopes, credential in ${paths.credentials} (mode 600).\n`)
    expect((await stat(paths.credentials)).mode & 0o777).toBe(0o600)
    expect((await stat(paths.dir)).mode & 0o777).toBe(0o700)
    const stored = parseCredential(await readFile(paths.credentials, "utf8"), "the file")
    expect(stored).toEqual({
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scopes: ACCOUNT_SCOPES,
      email: EMAIL,
    })
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("asks Google for the identity scopes of a label logged in for account", async () => {
    const { run, opened } = await login([
      "--toolsets",
      "account",
      "--client",
      await writeClientFile(await tempDir()),
      STATE_DIR_FLAG,
      await tempDir(),
    ])

    expect(run.code).toBe(EXIT_OK)
    const asked = new URL(opened[0]!).searchParams.get("scope")!.split(" ").sort()
    expect(asked).toEqual(ACCOUNT_SCOPES)
    expect(run.stderr).toContain(opened[0]!)
  })

  test("the label is default without --account, and --read-only and ~ in --client are accepted", async () => {
    const stateDir = await tempDir()
    const home = await tempDir()
    await writeClientFile(home)

    const { run } = await login(
      ["--toolsets=account", "--read-only", "--client=~/client.json", `${STATE_DIR_FLAG}=${stateDir}`],
      {
        env: { HOME: home },
      },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(await readdir(join(stateDir, "accounts"))).toEqual(["default"])
  })

  test("a refusal in the browser stores nothing and creates nothing", async () => {
    const stateDir = await tempDir()
    const run = await runCommand(
      runLoginCommand,
      ["--toolsets", "account", "--client", await writeClientFile(await tempDir()), STATE_DIR_FLAG, stateDir],
      {
        fetch: MUST_NOT_RUN,
        openBrowser: async (url) => {
          const { searchParams } = new URL(url)
          await visit(searchParams.get("redirect_uri")!, { state: searchParams.get("state")!, error: "access_denied" })
        },
      },
    )

    expect(run.code).toBe(1)
    expect(run.stderr).toContain("The consent was declined in the browser.")
    expect(await readdir(stateDir)).toEqual([])
  })

  test("a failure of Google's has the secrets masked out of its message", async () => {
    const stateDir = await tempDir()
    const google = fakeGoogle([
      {
        method: "POST",
        url: "https://oauth2.googleapis.com/token",
        reply: (request) => ({
          status: 400,
          json: { error: "invalid_client", error_description: `${CLIENT_SECRET} ${request.form!.code}` },
        }),
      },
    ])

    const run = await runCommand(
      runLoginCommand,
      ["--toolsets", "account", "--client", await writeClientFile(await tempDir()), STATE_DIR_FLAG, stateDir],
      { fetch: google.fetch, openBrowser: approvingBrowser },
    )

    expect(run.code).toBe(1)
    expect(run.stderr).toContain("[masked]")
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })
})

describe("login of a label that has a credential", () => {
  test("reuses the stored client, hints the stored address and replaces the token", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run, opened, requests } = await login(
      ["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir],
      {
        reply: { refresh_token: ROTATED_REFRESH_TOKEN },
      },
    )

    const paths = labelPaths(stateDir, "work")
    expect(run.code).toBe(EXIT_OK)
    expect(new URL(opened[0]!).searchParams.get("login_hint")).toBe(CREDENTIAL.email!)
    expect(new URL(opened[0]!).searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(requests[0]!.form).toMatchObject({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    const stored = parseCredential(await readFile(paths.credentials, "utf8"), "the file")
    expect(stored.refresh_token).toBe(ROTATED_REFRESH_TOKEN)
    expect(run.stderr).not.toContain("held a credential for")
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("says so when another account consented than the label held", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run } = await login(["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir], {
      reply: { id_token: idToken({ email: "another@example.test" }) },
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain("as another@example.test")
    expect(run.stderr).toContain(
      `The label held a credential for ${CREDENTIAL.email}; it now holds the one for another@example.test.`,
    )
  })

  test("--client replaces the stored client", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work", { ...CREDENTIAL, client_id: "old-client.apps.example" })

    const { run, requests } = await login([
      "--account",
      "work",
      "--toolsets",
      "account",
      "--client",
      await writeClientFile(await tempDir()),
      STATE_DIR_FLAG,
      stateDir,
    ])

    expect(run.code).toBe(EXIT_OK)
    expect(requests[0]!.form!.client_id).toBe(CLIENT_ID)
  })

  test("scopes left unchecked on the consent screen are listed, with the exit still 0", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const { run } = await login(["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir], {
      reply: { scope: OPENID_SCOPE },
    })

    const stored = parseCredential(await readFile(labelPaths(stateDir, "work").credentials, "utf8"), "the file")
    expect(run.code).toBe(EXIT_OK)
    expect(stored.scopes).toEqual([OPENID_SCOPE])
    expect(run.stdout).toContain(": 1 scope, credential in")
    expect(run.stderr).toContain(`not granted (left unchecked on the consent screen): ${EMAIL_SCOPE}.`)
    expect(run.stderr).toContain("logged in again with all of them checked")
  })
})

describe("login with the variable set", () => {
  const variable = credentialVariable(PROJECT.envPrefix, "work")

  test("stores nothing and runs no consent", async () => {
    const stateDir = await tempDir()

    const run = await runCommand(
      runLoginCommand,
      ["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir],
      {
        env: { [variable]: JSON.stringify(CREDENTIAL) },
        fetch: MUST_NOT_RUN,
        openBrowser: MUST_NOT_RUN,
      },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toBe(
      `Google account "work" uses the credential in ${variable}; nothing was stored and no consent was run.\n`,
    )
    expect(await readdir(labelPaths(stateDir, "work").dir)).toEqual([])
    expect(leaks(run, SECRETS)).toBe(false)
  })

  test("a credential file is left alone and said to be ignored", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    const { credentials } = labelPaths(stateDir, "work")

    const run = await runCommand(
      runLoginCommand,
      ["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir],
      {
        env: { [variable]: JSON.stringify(CREDENTIAL) },
        fetch: MUST_NOT_RUN,
        openBrowser: MUST_NOT_RUN,
      },
    )

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain(`The credential file ${credentials} is ignored while ${variable} is set.`)
    expect(parseCredential(await readFile(credentials, "utf8"), "the file")).toEqual(CREDENTIAL)
  })

  test("a variable that is not a credential fails without echoing it and creates nothing", async () => {
    const stateDir = await tempDir()

    const run = await runCommand(
      runLoginCommand,
      ["--account", "work", "--toolsets", "account", STATE_DIR_FLAG, stateDir],
      {
        env: { [variable]: `{ "refresh_token": "${REFRESH_TOKEN}" ` },
        fetch: MUST_NOT_RUN,
        openBrowser: MUST_NOT_RUN,
      },
    )

    expect(run.code).toBe(1)
    expect(run.stderr).toContain(`\`${variable}\` is not a Google credential`)
    expect(leaks(run, SECRETS)).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })
})
