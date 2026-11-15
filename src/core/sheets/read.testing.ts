import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ENV_PREFIX, CLI, NOW, tokenHandler } from "../account/read.testing"
import { CREDENTIAL } from "../google/client.fixtures"
import { writeCredential, type Credential } from "../google/credentials"
import { fakeGoogle, type FakeHandler } from "../google/fake-google.testing"
import { ensureLabelDir } from "../google/labels"
import { clearTokenCache } from "../google/token"
import type { ToolRuntime } from "../runtime"
import { invoke, type ToolContext } from "../tool"
import { googleSheetsRead } from "./read"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE } from "./scopes"

/** Fixtures the Sheets read tests share: a state directory with a label logged in for Sheets, a fake Google and a runtime over both. */

/** A made-up spreadsheet id, as Google writes one. */
export const SPREADSHEET_ID = "1MadeUpSpreadsheetId_abcdefghij-0123456789"

export const FILES_URL = "https://www.googleapis.com/drive/v3/files"
export const SPREADSHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`
export const BATCH_GET_URL = `${SPREADSHEET_URL}/values:batchGet`

/** What a label logged in for the sheets toolset, read only, holds. */
export const SHEETS_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, SHEETS_READ_SCOPE, DRIVE_METADATA_READ_SCOPE],
}

/** A GET handler for `url` that answers `reply`. */
export const answer = (url: string, reply: unknown): FakeHandler => ({ method: "GET", url, reply: { json: reply } })

/** The directories the fixtures made, which `cleanUp` removes. */
const made: string[] = []

/** Removes every state directory the fixtures made; each test file runs it after each test. */
export async function cleanUp(): Promise<void> {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
}

/** Starts every test with no access token cached by an earlier one. */
export const freshTokens = clearTokenCache

/** `METHOD origin+path` of a request, which is how a test names the calls the fake received. */
export function callOf(request: { method: string; url: URL }): string {
  return `${request.method} ${request.url.origin}${request.url.pathname}`
}

/**
 * A state directory with the label `work` holding `credential` (none when
 * `null`), an empty download directory, a fake Google answering `handlers` and
 * the token endpoint, and the tool's context over them, with `env` as the
 * runtime's environment.
 */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = SHEETS_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const stateDir = await mkdtemp(join(tmpdir(), "sheets-read-"))
  const downloadDir = await mkdtemp(join(tmpdir(), "sheets-downloads-"))
  made.push(stateDir, downloadDir)
  if (credential) await writeCredential(await ensureLabelDir(stateDir, "work"), credential)
  const google = fakeGoogle([tokenHandler, ...handlers])
  const runtime: ToolRuntime = { envPrefix: ENV_PREFIX, cli: CLI, env, fetch: google.fetch, now: () => NOW }
  const ctx: ToolContext = { cwd: stateDir, stateDir, downloadDir, runtime }
  return {
    stateDir,
    downloadDir,
    ctx,
    /** Everything the fake Google received, the token refresh included. */
    requests: google.requests,
    /** What the fake received other than the token refresh. */
    calls: () => google.requests.filter((request) => request.url.hostname !== "oauth2.googleapis.com"),
    read: (args: unknown) => invoke(googleSheetsRead, args, ctx),
  }
}
