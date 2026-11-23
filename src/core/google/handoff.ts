import { ToolError } from "../errors"
import type { Handoff } from "./routes"

/** What a download that Google handed off to an address this call does not accept says; it never repeats the address. */
const UNUSABLE_HANDOFF_MESSAGE =
  "Google handed the export to an address this call does not accept; nothing was fetched from it."

/**
 * The address `location` hands a download off to, when it is the route's own
 * (absolute, `https`, a host that matches `handoff.host` with no port, a path
 * under `handoff.pathPrefix`, no user info, no fragment); anything else is
 * `upstream_error` that does not repeat the address, and nothing is fetched
 * from it.
 */
export function handoffAddress(location: string | null, handoff: Handoff): URL {
  if (location === null) throw new ToolError("upstream_error", UNUSABLE_HANDOFF_MESSAGE)
  let address: URL
  try {
    address = new URL(location)
  } catch {
    throw new ToolError("upstream_error", UNUSABLE_HANDOFF_MESSAGE)
  }
  const valid =
    address.protocol === "https:" &&
    handoff.host.test(address.hostname) &&
    address.port === "" &&
    address.pathname.startsWith(handoff.pathPrefix) &&
    address.username === "" &&
    address.password === "" &&
    address.hash === ""
  if (!valid) throw new ToolError("upstream_error", UNUSABLE_HANDOFF_MESSAGE)
  return address
}

/** What identifies a handoff, which the client masks wherever it could show: the address as given and as used, and its signed query. */
export function handoffSecrets(location: string, address: URL): string[] {
  return [location, address.href, address.search].filter((secret) => secret !== "")
}
