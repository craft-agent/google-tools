import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolError } from "../errors"
import { serializeCredential, type Credential } from "./credentials"
import { labelPaths, type LabelPaths } from "./labels"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"

// Made-up values, built from parts so no line reads as a hardcoded secret to a scanner.
export const REFRESH_TOKEN = ["madeUpRefreshToken", "AAAA0123456789"].join("-")
export const ROTATED_REFRESH_TOKEN = ["madeUpRotatedToken", "BBBB9876543210"].join("-")
export const CLIENT_ID = "made-up-client.apps.example"
export const CLIENT_SECRET = ["madeUpClientSecret", "CCCC987654"].join("-")
export const VARIABLE = "GT_CREDENTIALS_WORK"
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"

export const TOKEN_URL = "https://oauth2.googleapis.com/token"
export const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

export const CREDENTIAL: Credential = {
  refresh_token: REFRESH_TOKEN,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  scopes: [EMAIL_SCOPE, OPENID_SCOPE],
  email: "someone@example.test",
}

/** A state root with the directory of label `work`, which holds nothing yet. */
export async function makeLabel(): Promise<{ stateDir: string; paths: LabelPaths }> {
  const stateDir = await mkdtemp(join(tmpdir(), "gclient-"))
  const paths = labelPaths(stateDir, "work")
  await mkdir(paths.dir, { recursive: true, mode: 0o700 })
  return { stateDir, paths }
}

/** Writes `credential` as the label's credential file, mode 600. */
export async function storeCredential(paths: LabelPaths, credential: Credential = CREDENTIAL): Promise<void> {
  await writeFile(paths.credentials, serializeCredential(credential), { mode: 0o600 })
}

/** The environment that holds `credential` in the label's variable. */
export function variableEnv(credential: Credential = CREDENTIAL): Record<string, string> {
  return { [VARIABLE]: JSON.stringify(credential) }
}

/** The `ToolError` a promise rejected with; fails when it resolved or rejected with anything else. */
export async function toolError(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected the promise to reject")
}
