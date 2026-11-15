import { ToolError } from "../errors"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_TOOLSET, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"

/** The scopes one toolset's tools need, read and write apart, each the narrowest an operation accepts. */
export type ToolsetScopes = {
  read: readonly string[]
  write: readonly string[]
}

/** The toolset of the account read, which needs the identity scopes alone. */
export const ACCOUNT_TOOLSET = "account"

/** The scopes of each toolset a label can be logged in for; each domain adds its own with its tools. */
export const TOOLSET_SCOPES: Readonly<Record<string, ToolsetScopes>> = {
  [ACCOUNT_TOOLSET]: { read: [], write: [] },
  [SHEETS_TOOLSET]: { read: [SHEETS_READ_SCOPE, DRIVE_METADATA_READ_SCOPE], write: [SHEETS_WRITE_SCOPE] },
}

/** What every login asks for besides its toolsets' scopes, so the label records the account's address. */
export const IDENTITY_SCOPES: readonly string[] = [OPENID_SCOPE, EMAIL_SCOPE]

/** The toolsets a credential's scopes cover, and those among them it holds only for reading. */
export type GrantedToolsets = {
  toolsets: string[]
  readOnly: string[]
}

/**
 * The toolsets of `table` (default `TOOLSET_SCOPES`, in its order) whose read
 * scopes are all among `scopes`; the account toolset needs the identity scopes
 * too and holds nothing without them. A covered toolset with write scopes that
 * are not all among `scopes` is also in `readOnly`.
 */
export function grantedToolsets(
  scopes: readonly string[],
  table: Readonly<Record<string, ToolsetScopes>> = TOOLSET_SCOPES,
): GrantedToolsets {
  const granted = new Set(scopes)
  const holdsAll = (needed: readonly string[]) => needed.every((scope) => granted.has(scope))
  const covered: GrantedToolsets = { toolsets: [], readOnly: [] }
  for (const [name, { read, write }] of Object.entries(table)) {
    const needed = name === ACCOUNT_TOOLSET ? [...IDENTITY_SCOPES, ...read] : read
    if (needed.length === 0 || !holdsAll(needed)) continue
    covered.toolsets.push(name)
    if (write.length > 0 && !holdsAll(write)) covered.readOnly.push(name)
  }
  return covered
}

/**
 * The scopes a login asks for: the identity scopes, the read scopes of each of
 * `toolsets` and, unless `readOnly`, their write scopes; deduplicated and
 * sorted. A toolset that has no scopes is `invalid_argument`, naming the known
 * ones but not repeating what was given, which a person may have mistyped as
 * something else.
 */
export function loginScopes(toolsets: readonly string[], readOnly: boolean): string[] {
  const scopes = new Set(IDENTITY_SCOPES)
  for (const name of toolsets) {
    const entry = Object.hasOwn(TOOLSET_SCOPES, name) ? TOOLSET_SCOPES[name] : undefined
    if (!entry) {
      throw new ToolError(
        "invalid_argument",
        `A toolset to log in for is not one of the known toolsets: ${Object.keys(TOOLSET_SCOPES).join(", ")}.`,
      )
    }
    for (const scope of entry.read) scopes.add(scope)
    if (!readOnly) for (const scope of entry.write) scopes.add(scope)
  }
  return [...scopes].sort()
}
