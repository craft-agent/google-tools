import { ACCOUNT_TOOLSET } from "../google/scopes"
import type { ToolRuntime } from "../runtime"

/** Characters a shell word may hold without quoting. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/** What a person gives `--client` for a label that has no credential file to take the OAuth client from. */
const CLIENT_PLACEHOLDER = "<client-file>"

/** POSIX shell quoting keeps a word, such as a path with a space, a single argument. */
function shellWord(value: string): string {
  return PLAIN_WORD.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** What the `login` command needs to name for a label. */
export type LoginFix = {
  label: string
  /** The toolsets the label is known to hold; none known asks for the account toolset alone. */
  toolsets: readonly string[]
  /** Whether the label holds some toolsets only for reading. */
  readOnly: boolean
  /** Whether the label has no credential the OAuth client can be taken from. */
  needsClient: boolean
}

/** The `login` command a person runs to give the label a new credential. */
export function loginCommand(runtime: ToolRuntime, stateDir: string, fix: LoginFix): string {
  const toolsets = fix.toolsets.length > 0 ? fix.toolsets : [ACCOUNT_TOOLSET]
  const words = [
    runtime.cli,
    "login",
    "--account",
    fix.label,
    "--toolsets",
    toolsets.join(","),
    ...(fix.readOnly ? ["--read-only"] : []),
    "--state-dir",
    stateDir,
  ].map(shellWord)
  return fix.needsClient ? [...words, "--client", CLIENT_PLACEHOLDER].join(" ") : words.join(" ")
}

/** The command that makes a credential file private, as the message of the refusal names it. */
export function privateFileCommand(path: string): string {
  return `chmod 600 ${JSON.stringify(path)}`
}

/** What a person does about a credential held in a variable: `login` stores nothing while the variable is set. */
export function variableFix(variable: string): string {
  return `Replace the credential in ${variable} with a new one, or unset it to use the label's credential file; login stores nothing while it is set.`
}
