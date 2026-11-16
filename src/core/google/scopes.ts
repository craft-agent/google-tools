import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE, DRIVE_TOOLSET } from "../drive/scopes"
import { ToolError } from "../errors"
import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  GMAIL_TOOLSET,
} from "../gmail/scopes"
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
  [GMAIL_TOOLSET]: { read: [GMAIL_READ_SCOPE], write: [GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE] },
  [DRIVE_TOOLSET]: { read: [DRIVE_READ_SCOPE], write: [DRIVE_FILE_SCOPE] },
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
 * The toolsets of `TOOLSET_SCOPES`, in its order, that hold the first of
 * `scopes` that any toolset holds, as a read or a write scope; none when no
 * toolset holds any. A route lists its scopes narrowest first, so this names
 * the toolsets that give the narrowest grant, never every one that would also do.
 * When `own`, the calling tool's toolset, holds any of `scopes`, it is the
 * only one named instead, since toolsets may share a scope.
 */
export function toolsetsFor(scopes: readonly string[], own?: string): string[] {
  if (own !== undefined && Object.hasOwn(TOOLSET_SCOPES, own)) {
    const { read, write } = TOOLSET_SCOPES[own]
    if (scopes.some((scope) => read.includes(scope) || write.includes(scope))) return [own]
  }
  for (const scope of scopes) {
    const holders = Object.entries(TOOLSET_SCOPES)
      .filter(([, { read, write }]) => [...read, ...write].includes(scope))
      .map(([name]) => name)
    if (holders.length > 0) return holders
  }
  return []
}

/** Whether a call that any one of `scopes` allows needs a write scope: none of them is a read scope of a toolset or an identity scope. */
export function needsWrite(scopes: readonly string[]): boolean {
  const reads = new Set([...IDENTITY_SCOPES, ...Object.values(TOOLSET_SCOPES).flatMap(({ read }) => read)])
  return !scopes.some((scope) => reads.has(scope))
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
