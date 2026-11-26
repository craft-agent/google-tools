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
import { planRevocation, readOtherCredentials, type GrantPlan } from "./shared-grant"

const YES_FLAG = "--yes"
const REVOKE_FLAG = "--revoke"

/** The HTTP status of Google's answer to revoking a token that is already revoked or has expired. */
const HTTP_BAD_REQUEST = 400

/** What labels share when one revocation logs the others out. */
const SAME_GRANT = "the same OAuth client for the same Google account"

/** How a logged-out label logs in again. */
const LOGIN_HINT = `login ${ACCOUNT_FLAG} <label> --toolsets <list>`

type RemoveCommand = {
  label: string
  yes: boolean
  revoke: boolean
  stateDir: string
}

/** What `remove` does at Google, in the numbers and labels its messages tell. */
type Outcome = {
  /** How many tokens are revoked. */
  revoked: number
  /** How many tokens are left valid. */
  kept: number
  /** The labels the revocation logs out. */
  loggedOut: string[]
  /** The labels because of which tokens are kept. */
  keepers: string[]
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
    switches: [YES_FLAG, REVOKE_FLAG],
  })
  if (rest.length > 0) {
    throw usageError(`Remove accepts only ${ACCOUNT_FLAG}, ${YES_FLAG}, ${REVOKE_FLAG} and ${STATE_DIR_FLAG}.`)
  }
  const stateDir = resolveCommandStateDir(values[STATE_DIR_FLAG], io)
  const account = values[ACCOUNT_FLAG]
  if (account === undefined) throw usageError(`Option ${ACCOUNT_FLAG} is required.`)
  return {
    label: commandLabel(account),
    yes: switches.has(YES_FLAG),
    revoke: switches.has(REVOKE_FLAG),
    stateDir,
  }
}

/** `one` for a count of 1, else `many`. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Labels in quotes as a list: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quotedList(labels: string[]): string {
  const quoted = labels.map((label) => `"${label}"`)
  return quoted.length < 2 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`
}

/** The labels use the same grant, which is why their tokens are kept: "a" uses …, "a" and "b" use …. */
function keepersUse(keepers: string[]): string {
  return `${quotedList(keepers)} ${plural(keepers.length, "uses", "use")} ${SAME_GRANT} and would be logged out too`
}

/** The tokens that are kept, as they are said while some other token of the label is revoked (`other`) or not. */
function keptTokens(outcome: Outcome): string {
  const other = outcome.revoked > 0 ? "other " : ""
  return `${other}${plural(outcome.kept, "token is", "tokens are")}`
}

/** The sentence of the confirmation for the tokens that are kept. */
function keptConfirmation(outcome: Outcome): string {
  const { kept, keepers } = outcome
  return (
    `Its ${keptTokens(outcome)} not revoked at Google, because ${keepersUse(keepers)}; ` +
    `${plural(kept, "it stays", "they stay")} valid there until the last such label is removed. ` +
    `To revoke ${plural(kept, "it", "them")} anyway, cancel and run remove with ${REVOKE_FLAG}.`
  )
}

/** What the person is told before being asked to confirm: what happens at Google and what is deleted here. */
function confirmationText(label: string, dir: string, outcome: Outcome): string {
  const { revoked, kept, loggedOut } = outcome
  const local = `the local state of "${label}" in ${dir}: its credential file and its lock.`
  const revokes = `revoke the ${plural(revoked, "token", "tokens")} of "${label}" at Google`
  if (revoked > 0 && loggedOut.length > 0) {
    return (
      `This will ${revokes}, which also logs out ${quotedList(loggedOut)}: ` +
      `${plural(loggedOut.length, "it uses", "they use")} ${SAME_GRANT}. It will then permanently delete ${local}`
    )
  }
  if (revoked > 0) {
    const text = `This will ${revokes} and permanently delete its local state in ${dir}: its credential file and its lock.`
    return kept > 0 ? `${text} ${keptConfirmation(outcome)}` : text
  }
  const text = `This will permanently delete ${local}`
  return kept > 0 ? `${text} ${keptConfirmation(outcome)}` : `${text} It has no credential to revoke at Google.`
}

/** The line of standard output that says what became of the label's tokens. */
function removedText(label: string, outcome: Outcome): string {
  const { revoked, kept, keepers } = outcome
  if (revoked === 0 && kept === 0)
    return `Removed "${label}": its local state is deleted; nothing could be revoked at Google.`
  const done =
    revoked > 0
      ? `Removed "${label}": ${plural(revoked, "its token is", "its tokens are")} revoked at Google and its local state is deleted`
      : `Removed "${label}": its local state is deleted`
  if (kept === 0) return `${done}.`
  return (
    `${done}; its ${keptTokens(outcome)} not revoked at Google, because ${keepersUse(keepers)}. ` +
    `The ${plural(kept, "token stays", "tokens stay")} valid at Google until the last such label is removed.`
  )
}

/** The line of standard output that says which labels the revocation logged out and how to log them in again. */
function loggedOutText(loggedOut: string[]): string {
  return (
    `${quotedList(loggedOut)} used ${SAME_GRANT}, so ${plural(loggedOut.length, "it is", "they are")} logged out too; ` +
    `${plural(loggedOut.length, "log it", "log each")} in again with ${LOGIN_HINT}.`
  )
}

/** The line of standard output that asks the person to clear the variable, and says whether the token in it still works. */
function variableText(variable: string, read: boolean, kept: boolean): string {
  if (!read) return `Clear ${variable} where it is set.`
  return `Clear ${variable} where it is set; the token in it ${kept ? "still works at Google" : "no longer works"}.`
}

/** What happens at Google to the label's tokens under `plan`. */
function outcomeOf(plan: GrantPlan): Outcome {
  const { revoke, kept, sharers } = plan
  return {
    revoked: revoke.length,
    kept: kept.length,
    loggedOut: kept.length === 0 ? sharers : [],
    keepers: kept.length > 0 ? sharers : [],
  }
}

/**
 * Whether the person typed the label to confirm, after being told what happens
 * at Google (which tokens are revoked, which labels that logs out, which tokens
 * are kept and why) and what is deleted here; no answer (input ended, or
 * cancelled) is a refusal.
 */
async function confirmed(label: string, dir: string, outcome: Outcome, io: CommandIo): Promise<boolean> {
  io.stderr(`${confirmationText(label, dir, outcome)}\n`)
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
 * The `remove` command: revokes the distinct tokens a Google account has, in
 * its variable and in its credential file, and deletes everything this machine
 * keeps for it (`--account`, required): its credential file and lock.
 *
 * Revoking one token ends the whole grant, so every other label logged in with
 * the same OAuth client for the same Google account would be logged out. A
 * token that shares a grant with another label's credential (in its variable or
 * its file), or with a kept token of the label, is therefore not revoked and
 * stays valid at Google until the last such label is removed; it is said. With
 * `--revoke` every token is revoked and the labels that share a grant with them
 * are said to be logged out.
 *
 * It reads the credentials of all labels, notes the sources that cannot be read
 * on standard error, and then asks the person to type the label, after telling
 * what happens at Google, unless `--yes` is given; without a terminal `--yes`
 * is required. A token Google says is already revoked counts as revoked; any
 * other failure to revoke stops the command before anything is deleted. A
 * source that cannot be read revokes nothing, and the label is still removed
 * locally. A variable cannot be cleared from here, which is said. Resolves to
 * the exit code: 0, 1 after a failure or a refusal, 2 for a mistake in the
 * command line.
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
    const envPrefix = (io.profile ?? PROJECT_PROFILE).envPrefix
    const variable = credentialVariable(envPrefix, label)
    const { credentials, notes, variableSet, variableRead } = await readLabelCredentials(paths, variable, io)
    const others = await readOtherCredentials({ stateDir, label, envPrefix, env: io.env })
    for (const credential of [...credentials, ...others.map((other) => other.credential)]) {
      secrets.push(...credentialSecrets(credential))
    }
    for (const note of notes) printCommandError(io, note)
    if (credentials.length === 0 && notes.length === 0) {
      printCommandError(io, `"${label}" has no credential, so nothing could be revoked at Google.`)
    }
    const plan = planRevocation(credentials, others, command.revoke)
    const outcome = outcomeOf(plan)
    if (!yes && !(await confirmed(label, dir, outcome, io))) {
      printCommandError(io, "Removal cancelled.")
      return EXIT_FAILED
    }

    throwIfCancelled(io.signal)
    if (plan.revoke.length > 0) {
      try {
        await revoke(paths, plan.revoke, io)
      } catch (error) {
        const code = handleCommandError(maskError(error, secrets), io, { abortMessage: "Cancelled." })
        printCommandError(io, `Nothing was removed; "${label}" is still set up.`)
        return code
      }
    }

    throwIfCancelled(io.signal)
    await removeLabel({ stateDir, label, signal: io.signal })
    io.stdout(`${removedText(label, outcome)}\n`)
    if (outcome.loggedOut.length > 0) io.stdout(`${loggedOutText(outcome.loggedOut)}\n`)
    if (variableSet) {
      const variableKept = variableRead && plan.kept.includes(credentials[0]!)
      io.stdout(`${variableText(variable, variableRead, variableKept)}\n`)
    }
    return EXIT_OK
  } catch (error) {
    return handleCommandError(maskError(error, secrets), io, { abortMessage: "Cancelled." })
  }
}
