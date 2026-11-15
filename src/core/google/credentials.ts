import { lstat, readFile } from "node:fs/promises"
import type { Stats } from "node:fs"
import { ToolError } from "../errors"
import type { LabelPaths } from "./labels"
import { isMissingPath } from "./missing-path"
import { writePrivateFile } from "./private-file"

/** Where a label's credential comes from: the environment variable, or the label's credential file. */
export type CredentialSource = "variable" | "file"

/** A label's whole credential: the refresh token, the OAuth client that issued it, the granted scopes and the account's address. */
export type Credential = {
  refresh_token: string
  client_id: string
  client_secret: string
  scopes: string[]
  email: string | null
}

/** Permission bits of group and others; a credential file may have none of them. */
const GROUP_OTHER_BITS = 0o077

/** Spaces of indentation in the credential file. */
const FILE_INDENT = 2

/** The fields of a credential that are non-empty strings. */
const STRING_FIELDS = ["refresh_token", "client_id", "client_secret"] as const

/** The name of the variable that holds a label's credential. */
export function credentialVariable(envPrefix: string, label: string): string {
  return `${envPrefix}_CREDENTIALS_${label.toUpperCase()}`
}

function notCredential(what: string, problem: string): ToolError {
  return new ToolError("unauthenticated", `${what} is not a Google credential: ${problem}.`)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== ""
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // The parser's message can quote the input, so it is dropped.
    throw notCredential(what, "the text is not valid JSON")
  }
}

/**
 * Parses the JSON `text` into a credential. Unknown keys are ignored, `scopes`
 * are deduplicated and sorted, and an absent `email` is null. Throws
 * `unauthenticated` naming the field that is wrong, never a value and never
 * the text.
 */
export function parseCredential(text: string, what: string): Credential {
  const data = parseJson(text, what)
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw notCredential(what, "it is not a JSON object")
  }
  const record = data as Record<string, unknown>
  for (const field of STRING_FIELDS) {
    if (!isNonEmptyString(record[field])) throw notCredential(what, `${field} must be a non-empty string`)
  }
  const scopes = record.scopes
  if (!Array.isArray(scopes) || !scopes.every(isNonEmptyString)) {
    throw notCredential(what, "scopes must be an array of non-empty strings")
  }
  const email = record.email ?? null
  if (email !== null && !isNonEmptyString(email)) {
    throw notCredential(what, "email must be a non-empty string or null")
  }
  return {
    refresh_token: record.refresh_token as string,
    client_id: record.client_id as string,
    client_secret: record.client_secret as string,
    scopes: [...new Set(scopes)].sort(),
    email,
  }
}

/** The file text of `credential`: its five fields in a fixed order, indented, with a trailing newline. */
export function serializeCredential(credential: Credential): string {
  const { refresh_token, client_id, client_secret, scopes, email } = credential
  return `${JSON.stringify({ refresh_token, client_id, client_secret, scopes, email }, null, FILE_INDENT)}\n`
}

/** The values of `credential` that must never reach a result, an error or a log. */
export function credentialSecrets(credential: Credential): string[] {
  return [credential.refresh_token, credential.client_secret]
}

async function statCredentialFile(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

/**
 * The label's credential: the variable when it is set, even empty, and the
 * file is then not read; else the credential file.
 *
 * The file must be a regular file, not a link, that only its owner can reach.
 * A credential that is missing or malformed throws `unauthenticated`; a bad
 * file throws `forbidden`. No message contains the credential.
 */
export async function readCredential(options: {
  paths: LabelPaths
  variable: string
  env: Readonly<Record<string, string | undefined>>
}): Promise<{ source: CredentialSource; credential: Credential }> {
  const { paths, variable, env } = options
  const fromVariable = env[variable]
  if (fromVariable !== undefined) {
    return { source: "variable", credential: parseCredential(fromVariable.trim(), `\`${variable}\``) }
  }

  const stat = await statCredentialFile(paths.credentials)
  if (!stat) {
    throw new ToolError(
      "unauthenticated",
      `No credential for Google account "${paths.label}": set ${variable} or log in with the login command.`,
      { details: { account: paths.label, variable } },
    )
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ToolError(
      "forbidden",
      `The credential file ${paths.credentials} is a link or not a regular file; replace it.`,
    )
  }
  if (stat.mode & GROUP_OTHER_BITS) {
    throw new ToolError(
      "forbidden",
      `The credential file ${paths.credentials} is readable by other users; run chmod 600 ${JSON.stringify(paths.credentials)}.`,
    )
  }
  const text = await readFile(paths.credentials, "utf8")
  return { source: "file", credential: parseCredential(text, `The credential file ${paths.credentials}`) }
}

/** Writes the label's credential file, private and atomically. The label's directory must exist. */
export async function writeCredential(paths: LabelPaths, credential: Credential): Promise<void> {
  await writePrivateFile(paths.credentials, serializeCredential(credential))
}
