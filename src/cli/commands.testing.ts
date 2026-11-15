import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CLIENT_ID, CLIENT_SECRET, CREDENTIAL } from "../core/google/client.fixtures"
import { writeCredential, type Credential } from "../core/google/credentials"
import { AUTH_CODE, targetOf, visit } from "../core/google/consent.testing"
import { ensureLabelDir } from "../core/google/labels"
import type { CommandIo } from "./command-io"

/** Fixtures the tests of the person-run commands share. */

export type CommandRun = { code: number; stdout: string; stderr: string }

export const STATE_DIR_FLAG = "--state-dir"

const tempDirs: string[] = []

/** A fresh temporary directory, removed by `removeTempDirs`. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gcommands-"))
  tempDirs.push(dir)
  return dir
}

/** Removes every directory `tempDir` made; each test file runs it in its own `afterEach`. */
export async function removeTempDirs(): Promise<void> {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
}

/** Runs a command over a collecting `CommandIo`; `overrides` replace any part of it. */
export async function runCommand(
  command: (argv: string[], io: CommandIo) => Promise<number>,
  argv: string[],
  overrides: Partial<CommandIo> = {},
): Promise<CommandRun> {
  let stdout = ""
  let stderr = ""
  const code = await command(argv, {
    env: {},
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...overrides,
  })
  return { code, stdout, stderr }
}

/** Whether anything the command said holds one of `secrets`. */
export function leaks(run: CommandRun, secrets: string[]): boolean {
  return secrets.some((secret) => (run.stdout + run.stderr).includes(secret))
}

/** The text of the JSON file the Google Cloud console downloads for a Desktop app (`installed`) or Web application (`web`) client. */
export function clientJson(kind: "installed" | "web" = "installed"): string {
  return JSON.stringify({ [kind]: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, project_id: "made-up" } })
}

/** Writes a client file into `dir` and returns its path. */
export async function writeClientFile(dir: string, text: string = clientJson()): Promise<string> {
  const path = join(dir, "client.json")
  await writeFile(path, text)
  return path
}

/** A browser that approves the consent with `AUTH_CODE`, as a person who clicked through would. */
export async function approvingBrowser(url: string): Promise<void> {
  const { redirectUri, state } = targetOf(url)
  await visit(redirectUri, { state, code: AUTH_CODE })
}

/** Creates the label's directory with a credential file in it, as a logged-in account has; returns the directory. */
export async function signedInAccount(
  stateDir: string,
  label: string,
  credential: Credential = CREDENTIAL,
): Promise<string> {
  const paths = await ensureLabelDir(stateDir, label)
  await writeCredential(paths, credential)
  return paths.dir
}

/** Writes `text` as the label's credential file instead of a credential. */
export async function writeCredentialText(stateDir: string, label: string, text: string): Promise<void> {
  const paths = await ensureLabelDir(stateDir, label)
  await writeFile(paths.credentials, text, { mode: 0o600 })
}
