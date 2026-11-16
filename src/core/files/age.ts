import { ToolError, isAbortError } from "../errors"
import { exec, type ExecResult } from "../exec"
import { MS_PER_SECOND } from "../google/fetch"
import { maskText } from "../google/mask"
import type { ToolContext } from "../tool"

/** The package setting that names the age public keys a file under `encrypt_dirs` is encrypted to. */
export const AGE_RECIPIENTS_OPTION = "age_recipients"

/** What an age-encrypted file's name ends in. */
export const AGE_EXTENSION = ".age"

/** The program that encrypts. */
const AGE_PROGRAM = "age"

/** An X25519 recipient: `age1` and 58 characters of the bech32 alphabet. */
const RECIPIENT_PATTERN = /^age1[02-9ac-hj-np-z]{58}$/

/** How long `age` may take to encrypt a file, in milliseconds. */
const ENCRYPT_TIMEOUT_MS = 600_000

/** How long `age --version` may take, in milliseconds. */
const VERSION_TIMEOUT_MS = 10_000

/** How much of a failed `age`'s standard error a message keeps, in characters. */
const MAX_STDERR_LENGTH = 200

/** Where `age` is looked for when the environment names no `PATH`. */
const DEFAULT_PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"

type AgeEnv = Readonly<Record<string, string | undefined>>

/** The age public keys the call's `age_recipients` setting names; none when a person has named none. */
export function ageRecipientsOf(ctx: Pick<ToolContext, "options">): readonly string[] {
  const recipients = ctx.options?.[AGE_RECIPIENTS_OPTION]
  return typeof recipients === "object" ? recipients : []
}

/**
 * The recipients to encrypt to, without repeats and sorted. No recipient is
 * `forbidden` (a person names them); an entry that is not an X25519 age
 * public key is `invalid_argument`, naming its place in the setting and
 * never repeating it.
 */
export function checkedRecipients(recipients: readonly string[]): string[] {
  if (recipients.length === 0) {
    throw new ToolError(
      "forbidden",
      `No recipient is set; files under the encrypt_dirs directories go up only encrypted, so a person names the age public keys to encrypt to with the ${AGE_RECIPIENTS_OPTION} setting.`,
    )
  }
  const invalid = recipients.findIndex((recipient) => !RECIPIENT_PATTERN.test(recipient))
  if (invalid >= 0) {
    throw new ToolError(
      "invalid_argument",
      `Entry ${invalid + 1} of ${recipients.length} in the ${AGE_RECIPIENTS_OPTION} setting is not an age public key (an X25519 recipient: age1 and 58 more characters).`,
    )
  }
  return [...new Set(recipients)].sort()
}

/** `PATH` only: age needs nothing else to encrypt to a public key. */
function ageEnv(env: AgeEnv): Record<string, string> {
  return { PATH: env.PATH ?? DEFAULT_PATH }
}

function ageUnavailable(): ToolError {
  return new ToolError(
    "upstream_error",
    "age is not installed, or is not on the PATH; it must be installed for files under the encrypt_dirs directories, which are never uploaded unencrypted.",
  )
}

/** What a failed run of age says, masked and clipped to `MAX_STDERR_LENGTH` characters. */
function stderrOf(result: ExecResult): string {
  return maskText(result.stderr.trim()).slice(0, MAX_STDERR_LENGTH) || `exit code ${result.code}`
}

/** `error` as a `ToolError` of a program that could not be run: age missing is its own message; a cancellation passes as it is. */
function runFailure(error: unknown): unknown {
  if (isAbortError(error)) return error
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return ageUnavailable()
  return new ToolError("upstream_error", `age could not be started: ${maskText((error as Error).message)}`)
}

/** Fails unless age can be run: `age --version` must exit 0. Nothing is read or written. */
export async function requireAge(env: AgeEnv, signal?: AbortSignal): Promise<void> {
  let result: ExecResult
  try {
    result = await exec([AGE_PROGRAM, "--version"], { env: ageEnv(env), signal, timeoutMs: VERSION_TIMEOUT_MS })
  } catch (error) {
    throw runFailure(error)
  }
  if (result.code !== 0) throw new ToolError("upstream_error", `age does not run: ${stderrOf(result)}`)
}

export type EncryptOptions = {
  /** The X25519 recipients to encrypt to, as `checkedRecipients` gives them. */
  recipients: readonly string[]
  /** The file age writes the ciphertext to. */
  output: string
  /** The plaintext, read as age takes it in. An error it throws is the call's error, as it is. */
  input: AsyncIterable<Uint8Array>
  /** The call's environment, of which only `PATH` reaches age. */
  env: AgeEnv
  signal?: AbortSignal
}

/**
 * Runs `age -r <recipient>… -o <output>` with `input` on its standard input
 * and resolves when age exits 0. age missing, a failed run (its standard
 * error, masked and clipped) and a run past `ENCRYPT_TIMEOUT_MS` are
 * `upstream_error`; a cancellation rejects as it is, and so does an error of
 * `input`, whatever it is.
 */
export async function encryptWithAge({ recipients, output, input, env, signal }: EncryptOptions): Promise<void> {
  let inputError: { error: unknown } | undefined
  async function* watched(): AsyncGenerator<Uint8Array> {
    try {
      yield* input
    } catch (error) {
      inputError = { error }
      throw error
    }
  }
  const argv = [AGE_PROGRAM, ...recipients.flatMap((recipient) => ["-r", recipient]), "-o", output]
  let result: ExecResult
  try {
    result = await exec(argv, { env: ageEnv(env), stdin: watched(), signal, timeoutMs: ENCRYPT_TIMEOUT_MS })
  } catch (error) {
    throw inputError ? inputError.error : runFailure(error)
  }
  if (result.timedOut) {
    throw new ToolError("upstream_error", `age did not finish within ${ENCRYPT_TIMEOUT_MS / MS_PER_SECOND} s.`)
  }
  if (result.code !== 0) throw new ToolError("upstream_error", `age failed: ${stderrOf(result)}`)
}
