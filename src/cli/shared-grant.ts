import { isToolError } from "../core"
import { credentialVariable, readCredential, type Credential } from "../core/google/credentials"
import { labelPaths, listLabels } from "../core/google/labels"
import type { CommandIo } from "./command-io"

/** A credential of one label. */
export type LabelCredential = {
  label: string
  credential: Credential
}

/** What `remove` does with the credentials of the label it removes. */
export type GrantPlan = {
  /** The credentials whose tokens are revoked at Google. */
  revoke: Credential[]
  /** The credentials whose tokens are left valid at Google, because revoking them would end another label's grant. */
  kept: Credential[]
  /**
   * The other labels whose credentials share a grant with the kept ones, or,
   * when nothing is kept, with any revoked one (the labels the revocation logs
   * out); distinct and sorted.
   */
  sharers: string[]
}

/**
 * Whether two credentials may belong to one grant, which one revocation ends
 * for all of them: the same OAuth client and the same account, an account
 * being unknown (no email) taken as possibly the same.
 */
export function sharesGrant(a: Credential, b: Credential): boolean {
  return a.client_id === b.client_id && (a.email === null || b.email === null || a.email === b.email)
}

/**
 * Every credential that the labels other than `label` have, in their variable
 * (when set in `env`) and in their credential file, label by label. A source
 * that cannot be read, a missing file included, is left out without a word; an
 * error that is not a `ToolError` is rethrown.
 */
export async function readOtherCredentials(options: {
  stateDir: string
  label: string
  envPrefix: string
  env: CommandIo["env"]
}): Promise<LabelCredential[]> {
  const { stateDir, label, envPrefix, env } = options
  const found: LabelCredential[] = []
  for (const other of await listLabels(stateDir)) {
    if (other === label) continue
    const paths = labelPaths(stateDir, other)
    const variable = credentialVariable(envPrefix, other)
    const sources = [...(env[variable] !== undefined ? [env] : []), {}]
    for (const sourceEnv of sources) {
      try {
        const { credential } = await readCredential({ paths, variable, env: sourceEnv })
        found.push({ label: other, credential })
      } catch (error) {
        if (!isToolError(error)) throw error
      }
    }
  }
  return found
}

/**
 * Sorts the label's own `credentials` into those to revoke and those to keep.
 * A credential is kept when it shares a grant with a credential of another
 * label, or with an own credential that is kept: revoking it would end the
 * grant of that one too. With `revokeAll` nothing is kept, and `sharers` are
 * the labels that revoking everything logs out.
 */
export function planRevocation(credentials: Credential[], others: LabelCredential[], revokeAll: boolean): GrantPlan {
  const keptSet = new Set<Credential>()
  let grew = !revokeAll
  while (grew) {
    grew = false
    for (const credential of credentials) {
      if (keptSet.has(credential)) continue
      const shared =
        others.some((other) => sharesGrant(credential, other.credential)) ||
        [...keptSet].some((keptCredential) => sharesGrant(credential, keptCredential))
      if (shared) {
        keptSet.add(credential)
        grew = true
      }
    }
  }

  const kept = credentials.filter((credential) => keptSet.has(credential))
  const revoke = credentials.filter((credential) => !keptSet.has(credential))
  const affected = revokeAll ? credentials : kept
  const sharers = [
    ...new Set(
      others
        .filter((other) => affected.some((credential) => sharesGrant(credential, other.credential)))
        .map((other) => other.label),
    ),
  ].sort()
  return { revoke, kept, sharers }
}
