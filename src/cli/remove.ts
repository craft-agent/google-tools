import { isToolError } from "../core"
import { credentialSecrets, credentialVariable, readCredential, type Credential } from "../core/google/credentials"
import { DEFAULT_TIMEOUT_MS } from "../core/google/fetch"
import { INVALID_TOKEN } from "../core/google/google-errors"
import { pickLabel, type LabelPaths } from "../core/google/labels"
import { maskError } from "../core/google/mask"
import { withRefreshLock } from "../core/google/refresh-lock"
import { removeLabel } from "../core/google/removal"
import { postOAuth } from "../core/google/token"
import { PROJECT_PROFILE } from "../entry/profile"
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
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, defaultReadLine, throwIfCancelled, type CommandIo } from "./command-io"
import { pathExists } from "./path-exists"

const YES_FLAG = "--yes"

/** The HTTP status of Google's answer to revoking a token that is already revoked or has expired. */
const HTTP_BAD_REQUEST = 400

type RemoveCommand = {
  label: string
  yes: boolean
  stateDir: string
}

/** What the command found of the label's credentials. */
type LabelCredentials = {
  /** The distinct credentials that parse, the variable's first. */
  credentials: Credential[]
  /** One line for each source that is there but cannot be read. */
  notes: string[]
  /** Whether the label's variable is set, even to something that is not a credential. */
  variableSet: boolean
  /** Whether the variable's credential parsed. */
  variableRead: boolean
}

function parseRemoveCommand(argv: string[], io: CommandIo): RemoveCommand {
  const { values, switches, rest } = parseFlagArgs(argv, {
    values: [ACCOUNT_FLAG, STATE_DIR_FLAG],
    switches: [YES_FLAG],
  })
  if (rest.length > 0) throw usageError(`Remove accepts only ${ACCOUNT_FLAG}, ${YES_FLAG} and ${STATE_DIR_FLAG}.`)
  const stateDir = resolveCommandStateDir(values[STATE_DIR_FLAG], io)
  const account = values[ACCOUNT_FLAG]
  if (account === undefined) throw usageError(`Option ${ACCOUNT_FLAG} is required.`)
  return { label: commandLabel(account), yes: switches.has(YES_FLAG), stateDir }
}

/** Whether the person typed the label to confirm; no answer (input ended, or cancelled) is a refusal. */
async function confirmed(label: string, dir: string, io: CommandIo): Promise<boolean> {
  io.stderr(
    `This will revoke the token of "${label}" at Google and permanently delete its local state in ${dir}: its credential file and its lock.\n`,
  )
  const prompt = `To confirm, type the label "${label}": `
  const answer = await (io.readLine?.(prompt) ?? defaultReadLine(prompt, io.signal))
  return answer === label
}

/**
 * Every credential the label has, from its variable (when set) and its file:
 * those that parse, distinct by refresh token and the variable's first, and a
 * note for each that is there but cannot be read. A file that does not exist
 * is no note.
 */
async function readLabelCredentials(paths: LabelPaths, variable: string, io: CommandIo): Promise<LabelCredentials> {
  const credentials: Credential[] = []
  const notes: string[] = []

  /** Reads one source into `credentials`; whether it parsed. */
  const take = async (what: string, env: CommandIo["env"], mayBeAbsent: boolean): Promise<boolean> => {
    try {
      const { credential } = await readCredential({ paths, variable, env })
      if (!credentials.some((known) => known.refresh_token === credential.refresh_token)) credentials.push(credential)
      return true
    } catch (error) {
      if (!isToolError(error)) throw error
      if (!mayBeAbsent || (await pathExists(paths.credentials))) {
        notes.push(`${what} could not be read, so its token was not revoked: ${error.message}`)
      }
      return false
    }
  }

  const variableSet = io.env[variable] !== undefined
  const variableRead = variableSet && (await take(`The credential in ${variable}`, io.env, false))
  await take(`The credential file ${paths.credentials}`, {}, true)
  return { credentials, notes, variableSet, variableRead }
}

/** Whether Google's answer to a revoke says the token is already revoked or has expired, which is what the person wants. */
function isAlreadyRevoked(error: unknown): boolean {
  return isToolError(error) && error.details?.status === HTTP_BAD_REQUEST && error.details.reason === INVALID_TOKEN
}

/** Revokes each credential's refresh token at Google, one after the other under the label's refresh lock; a token already revoked counts as revoked and any other failure stops the rest. */
async function revoke(paths: LabelPaths, credentials: Credential[], io: CommandIo): Promise<void> {
  await withRefreshLock(
    paths.lock,
    async () => {
      for (const credential of credentials) {
        try {
          await postOAuth(
            io.fetch ?? fetch,
            "revoke",
            { token: credential.refresh_token },
            { timeoutMs: DEFAULT_TIMEOUT_MS, signal: io.signal },
          )
        } catch (error) {
          if (!isAlreadyRevoked(error)) throw error
        }
      }
    },
    { signal: io.signal },
  )
}

/**
 * The `remove` command: revokes every distinct token a Google account has, in
 * its variable and in its credential file, and deletes everything this machine
 * keeps for it (`--account`, required): its credential file and lock. It asks
 * the person to type the label, unless `--yes` is given; without a terminal
 * `--yes` is required. A token Google says is already revoked counts as
 * revoked; any other failure to revoke stops the command before anything is
 * deleted. A source that cannot be read revokes nothing and is said on
 * standard error, and the label is still removed locally. A variable cannot be
 * cleared from here, which is said. Resolves to the exit code: 0, 1 after a failure or a refusal, 2 for a
 * mistake in the command line.
 */
export async function runRemoveCommand(argv: string[], io: CommandIo): Promise<number> {
  let command: RemoveCommand
  try {
    command = parseRemoveCommand(argv, io)
  } catch (error) {
    return handleCommandError(error, io, { mode: "usage" })
  }
  const { yes, stateDir } = command

  if (!yes && !(io.isTTY ?? Boolean(process.stdin.isTTY))) {
    printCommandError(io, `Removing a Google account without a terminal requires ${YES_FLAG}.`)
    return EXIT_USAGE
  }

  const secrets: string[] = []
  try {
    throwIfCancelled(io.signal)
    const paths = await pickLabel(stateDir, command.label)
    const { label, dir } = paths
    if (!yes && !(await confirmed(label, dir, io))) {
      printCommandError(io, "Removal cancelled.")
      return EXIT_FAILED
    }

    throwIfCancelled(io.signal)
    const variable = credentialVariable((io.profile ?? PROJECT_PROFILE).envPrefix, label)
    const { credentials, notes, variableSet, variableRead } = await readLabelCredentials(paths, variable, io)
    for (const note of notes) printCommandError(io, note)
    if (credentials.length === 0 && notes.length === 0) {
      printCommandError(io, `"${label}" has no credential, so nothing could be revoked at Google.`)
    }
    for (const credential of credentials) secrets.push(...credentialSecrets(credential))
    if (credentials.length > 0) {
      try {
        await revoke(paths, credentials, io)
      } catch (error) {
        const code = handleCommandError(maskError(error, secrets), io, { abortMessage: "Cancelled." })
        printCommandError(io, `Nothing was removed; "${label}" is still set up.`)
        return code
      }
    }

    throwIfCancelled(io.signal)
    await removeLabel({ stateDir, label, signal: io.signal })
    const revoked = credentials.length === 1 ? "its token is" : "its tokens are"
    io.stdout(
      credentials.length === 0
        ? `Removed "${label}": its local state is deleted; nothing could be revoked at Google.\n`
        : `Removed "${label}": ${revoked} revoked at Google and its local state is deleted.\n`,
    )
    if (variableSet) {
      io.stdout(
        variableRead
          ? `Clear ${variable} where it is set; the token in it no longer works.\n`
          : `Clear ${variable} where it is set.\n`,
      )
    }
    return EXIT_OK
  } catch (error) {
    return handleCommandError(maskError(error, secrets), io, { abortMessage: "Cancelled." })
  }
}
