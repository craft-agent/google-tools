import { lstat } from "node:fs/promises"
import type { Stats } from "node:fs"
import { isToolError, type ToolError } from "../errors"
import { readCredential, credentialVariable, type Credential, type CredentialSource } from "../google/credentials"
import type { LabelPaths } from "../google/labels"
import { maskError } from "../google/mask"
import { isMissingPath } from "../google/missing-path"
import type { GrantedToolsets } from "../google/scopes"
import type { ToolRuntime } from "../runtime"
import { loginCommand, privateFileCommand, variableFix } from "./fix"
import type { AccountProblem } from "./schemas"

/** What a label's credential is like, as far as the variable and the file tell, without contacting Google. */
export type LabelState = {
  paths: LabelPaths
  /** The name of the variable that may hold the label's credential, never its value. */
  variable: string
  /** Where the credential comes from, as far as it is known. */
  source: CredentialSource | null
  /** The credential, when it could be read. */
  credential: Credential | null
  /** Why it could not be read, and what a person does about it. */
  problem: AccountProblem | null
  fix: string | null
}

async function inspectFile(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

/** The error as a problem: its code and its message, masked. */
export function problemOf(error: ToolError, secrets: readonly string[] = []): AccountProblem {
  const masked = maskError(error, secrets) as ToolError
  return { code: masked.code, message: masked.message }
}

/** The step for a credential that could not be read: a mode to fix, a variable to correct, or a login. */
function unreadableFix(
  error: ToolError,
  state: Pick<LabelState, "paths" | "variable" | "source">,
  file: Stats | undefined,
  runtime: ToolRuntime,
  stateDir: string,
): string {
  if (state.source === "variable") return variableFix(state.variable)
  if (error.code === "forbidden" && file?.isFile()) return privateFileCommand(state.paths.credentials)
  return loginCommand(runtime, stateDir, { label: state.paths.label, toolsets: [], readOnly: false, needsClient: true })
}

/**
 * Reads the label's credential and says what is wrong with it when it cannot
 * be read: `source` as far as it is known, the masked error and the one step
 * for a person. Only the credential's own failures are caught; anything else
 * is a failure of the call.
 */
export async function readLabelState(runtime: ToolRuntime, stateDir: string, paths: LabelPaths): Promise<LabelState> {
  const variable = credentialVariable(runtime.envPrefix, paths.label)
  try {
    const { source, credential } = await readCredential({ paths, variable, env: runtime.env })
    return { paths, variable, source, credential, problem: null, fix: null }
  } catch (error) {
    if (!isToolError(error)) throw error
    const file = await inspectFile(paths.credentials)
    const source: CredentialSource | null = runtime.env[variable] !== undefined ? "variable" : file ? "file" : null
    const state = { paths, variable, source }
    return {
      ...state,
      credential: null,
      problem: problemOf(error),
      fix: unreadableFix(error, state, file, runtime, stateDir),
    }
  }
}

/** The step for a label Google refused: a new login with the toolsets it holds, or the variable to correct. */
export function refusalFix(
  runtime: ToolRuntime,
  stateDir: string,
  state: LabelState,
  granted: GrantedToolsets,
): string {
  if (state.source === "variable") return variableFix(state.variable)
  return loginCommand(runtime, stateDir, {
    label: state.paths.label,
    toolsets: granted.toolsets,
    readOnly: granted.readOnly.length > 0,
    needsClient: false,
  })
}
