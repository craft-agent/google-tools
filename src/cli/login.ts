import { readFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { ToolError, isToolError } from "../core"
import { parseClientFile, type OAuthClient } from "../core/google/client-file"
import { runConsent } from "../core/google/consent"
import {
  credentialSecrets,
  credentialVariable,
  parseCredential,
  readCredential,
  writeCredential,
  type Credential,
} from "../core/google/credentials"
import { DEFAULT_LABEL, ensureLabelDir, labelPaths, type LabelPaths } from "../core/google/labels"
import { maskError } from "../core/google/mask"
import { withRefreshLock } from "../core/google/refresh-lock"
import { TOOLSET_SCOPES, loginScopes } from "../core/google/scopes"
import { PROJECT_PROFILE } from "../entry/profile"
import { homeOf } from "../entry/state-dir"
import { openInBrowser } from "./browser"
import {
  ACCOUNT_FLAG,
  STATE_DIR_FLAG,
  commandLabel,
  handleCommandError,
  parseFlagArgs,
  printCommandError,
  resolveCommandStateDir,
  usageError,
} from "./command-args"
import { EXIT_OK, EXIT_USAGE, throwIfCancelled, type CommandIo } from "./command-io"
import { pathExists } from "./path-exists"

const TOOLSETS_FLAG = "--toolsets"
const READ_ONLY_FLAG = "--read-only"
const CLIENT_FLAG = "--client"

const USAGE = `Login accepts only ${ACCOUNT_FLAG}, ${TOOLSETS_FLAG}, ${READ_ONLY_FLAG}, ${CLIENT_FLAG} and ${STATE_DIR_FLAG}; no credential is ever an argument.`

/** Names the client file in the messages about it, without repeating what the person typed. */
const CLIENT_FILE = `The file given to ${CLIENT_FLAG}`

type LoginCommand = {
  stateDir: string
  label: string
  clientFile: string | undefined
  /** The scopes the login asks for. */
  scopes: string[]
}

/** Reads the command line; its arguments are never echoed beyond the flags' names, since one may have been a secret. */
function parseLoginCommand(argv: string[], io: CommandIo): LoginCommand {
  const { values, switches, rest } = parseFlagArgs(argv, {
    values: [ACCOUNT_FLAG, STATE_DIR_FLAG, TOOLSETS_FLAG, CLIENT_FLAG],
    switches: [READ_ONLY_FLAG],
  })
  if (rest.length > 0) throw usageError(USAGE)
  const stateDir = resolveCommandStateDir(values[STATE_DIR_FLAG], io)
  const label = commandLabel(values[ACCOUNT_FLAG] ?? DEFAULT_LABEL)
  const toolsets = (values[TOOLSETS_FLAG] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
  if (toolsets.length === 0) {
    throw usageError(`Option ${TOOLSETS_FLAG} is required; known toolsets: ${Object.keys(TOOLSET_SCOPES).join(", ")}.`)
  }
  return {
    stateDir,
    label,
    clientFile: values[CLIENT_FLAG],
    scopes: loginScopes(toolsets, switches.has(READ_ONLY_FLAG)),
  }
}

/** The label's credential file as it is, or undefined when there is none to read; the file is read as a login would find it, never the variable. */
async function storedCredential(paths: LabelPaths, variable: string): Promise<Credential | undefined> {
  try {
    return (await readCredential({ paths, variable, env: {} })).credential
  } catch (error) {
    if (isToolError(error)) return undefined
    throw error
  }
}

/** The path of `--client`, with a leading `~` standing for the home directory. */
function clientPath(path: string, env: CommandIo["env"]): string {
  return path === "~" || path.startsWith("~/") || path.startsWith(`~${sep}`) ? join(homeOf(env), path.slice(1)) : path
}

async function readClientFile(path: string, env: CommandIo["env"]): Promise<string> {
  try {
    return await readFile(clientPath(path, env), "utf8")
  } catch (error) {
    // The path is not repeated: it may be a pasted secret.
    const reason = (error as NodeJS.ErrnoException).code ?? "unreadable"
    throw new ToolError("invalid_argument", `${CLIENT_FILE} could not be read (${reason}).`)
  }
}

/** The OAuth client the login presents: the file given, else the one the label's credential was issued by; undefined when it has neither. */
async function loginClient(
  clientFile: string | undefined,
  stored: Credential | undefined,
  env: CommandIo["env"],
): Promise<OAuthClient | undefined> {
  if (clientFile !== undefined) return parseClientFile(await readClientFile(clientFile, env), CLIENT_FILE)
  return stored && { client_id: stored.client_id, client_secret: stored.client_secret }
}

const CLIENT_NEEDED = `Option ${CLIENT_FLAG} <file> is needed for a new label, and for one whose credential file cannot be read: give the JSON file of a Desktop app OAuth client.`

/** The label's credential comes from its variable: nothing is stored and no consent runs. */
async function useVariable(command: LoginCommand, variable: string, text: string, io: CommandIo): Promise<number> {
  parseCredential(text.trim(), `\`${variable}\``)
  const paths = await ensureLabelDir(command.stateDir, command.label)
  const lines = [
    `Google account "${command.label}" uses the credential in ${variable}; nothing was stored and no consent was run.`,
  ]
  if (await pathExists(paths.credentials)) {
    lines.push(`The credential file ${paths.credentials} is ignored while ${variable} is set.`)
  }
  io.stdout(`${lines.join("\n")}\n`)
  return EXIT_OK
}

function say(io: CommandIo, text: string): void {
  io.stderr(`${text}\n`)
}

/** Tells what the person must know about the login that the one-line result does not. */
function reportOutcome(io: CommandIo, asked: string[], stored: Credential, previous: Credential | undefined): void {
  const missing = asked.filter((scope) => !stored.scopes.includes(scope))
  if (missing.length > 0) {
    say(
      io,
      `These scopes were asked for but not granted (left unchecked on the consent screen): ${missing.join(", ")}.`,
    )
    say(io, "The tools that need them fail until the account is logged in again with all of them checked.")
  }
  if (previous?.email && stored.email && previous.email.toLowerCase() !== stored.email.toLowerCase()) {
    say(io, `The label held a credential for ${previous.email}; it now holds the one for ${stored.email}.`)
  }
}

async function login(command: LoginCommand, io: CommandIo, secrets: string[]): Promise<number> {
  const { stateDir, label } = command
  const variable = credentialVariable((io.profile ?? PROJECT_PROFILE).envPrefix, label)
  const fromVariable = io.env[variable]
  if (fromVariable !== undefined) return useVariable(command, variable, fromVariable, io)

  const previous = await storedCredential(labelPaths(stateDir, label), variable)
  if (previous) secrets.push(...credentialSecrets(previous))
  const client = await loginClient(command.clientFile, previous, io.env)
  if (!client) {
    printCommandError(io, CLIENT_NEEDED)
    return EXIT_USAGE
  }
  secrets.push(client.client_secret)

  throwIfCancelled(io.signal)
  const result = await runConsent({
    clientId: client.client_id,
    clientSecret: client.client_secret,
    scopes: command.scopes,
    fetch: io.fetch ?? fetch,
    openBrowser: io.openBrowser ?? ((url) => openInBrowser(url, io.env, io.signal)),
    notify: (text) => say(io, text),
    signal: io.signal,
    loginHint: previous?.email ?? undefined,
  })
  secrets.push(result.refresh_token)

  const credential: Credential = {
    refresh_token: result.refresh_token,
    ...client,
    scopes: [...new Set(result.scopes)].sort(),
    email: result.email,
  }
  const paths = await ensureLabelDir(stateDir, label)
  await withRefreshLock(paths.lock, () => writeCredential(paths, credential), { signal: io.signal })

  const count = credential.scopes.length
  const who = credential.email ?? "an account whose address Google did not give"
  io.stdout(
    `Logged in "${label}" as ${who}: ${count} ${count === 1 ? "scope" : "scopes"}, credential in ${paths.credentials} (mode 600).\n`,
  )
  reportOutcome(io, command.scopes, credential, previous)
  return EXIT_OK
}

/**
 * The `login` command: gives a Google account (`--account <label>`, default
 * `default`) its credential for the toolsets of `--toolsets <a,b>`, whose
 * scopes it asks for (only their read scopes with `--read-only`) beside the
 * identity ones. When the label's `<envPrefix>_CREDENTIALS_<LABEL>` variable is
 * set the credential is the variable's, nothing is stored and no consent runs.
 * Otherwise the person consents in the browser, with the OAuth client of
 * `--client <file>` (the JSON the Google Cloud console downloads for a Desktop
 * app) or, when the label already has a credential file, that file's client;
 * the credential is then stored in the label's directory with mode 600. No
 * credential is an argument or in a message. Takes `--state-dir <path>` too.
 * Resolves to the exit code: 0, 1 after a failure, 2 for a mistake in the
 * command line itself (an unknown or missing flag, an unknown toolset, a
 * malformed label, no `--client` for a label that has no client yet).
 */
export async function runLoginCommand(argv: string[], io: CommandIo): Promise<number> {
  let command: LoginCommand
  try {
    command = parseLoginCommand(argv, io)
  } catch (error) {
    return handleCommandError(error, io, { mode: "usage" })
  }

  const secrets: string[] = []
  try {
    throwIfCancelled(io.signal)
    return await login(command, io, secrets)
  } catch (error) {
    return handleCommandError(maskError(error, secrets), io, { abortMessage: "Cancelled." })
  }
}
