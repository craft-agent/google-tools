import { ToolError } from "../errors"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"

/** The scopes one toolset's tools need, read and write apart, each the narrowest an operation accepts. */
export type ToolsetScopes = {
  read: readonly string[]
  write: readonly string[]
}

/** The scopes of each toolset a label can be logged in for; each domain adds its own with its tools. */
export const TOOLSET_SCOPES: Readonly<Record<string, ToolsetScopes>> = {
  account: { read: [], write: [] },
}

/** What every login asks for besides its toolsets' scopes, so the label records the account's address. */
export const IDENTITY_SCOPES: readonly string[] = [OPENID_SCOPE, EMAIL_SCOPE]

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
