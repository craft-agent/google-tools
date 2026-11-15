import { ToolError } from "../errors"

/** The HTTP methods a route may use. */
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** One call the package may make: a method, a host and a path template, with the scopes that allow it. */
export type Route = {
  readonly method: Method
  /** A bare host name, one of `HOSTS`. */
  readonly host: string
  /** A path template such as `/v1/files/{file_id}`. */
  readonly path: string
  /** The OAuth scopes, any one of which lets a label call the route; empty for a route that takes no access token. */
  readonly scopes: readonly string[]
}

/** A query value; an array repeats the key once per item and `undefined` leaves the key out. */
export type QueryValue = string | number | boolean | readonly string[] | undefined

/** The scope that makes a login return an ID token. */
export const OPENID_SCOPE = "openid"

/** The scope of the account's address, as Google names it in a token reply. */
export const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email"

/** The hosts the package may reach; a route on any other host is refused. */
export const HOSTS: readonly string[] = ["oauth2.googleapis.com", "openidconnect.googleapis.com"]

/** The OAuth endpoints. The token and revoke calls take no access token; userinfo accepts a token holding `openid` or `email`. */
export const OAUTH_ROUTES = {
  token: { method: "POST", host: "oauth2.googleapis.com", path: "/token", scopes: [] },
  revoke: { method: "POST", host: "oauth2.googleapis.com", path: "/revoke", scopes: [] },
  userinfo: {
    method: "GET",
    host: "openidconnect.googleapis.com",
    path: "/v1/userinfo",
    scopes: [OPENID_SCOPE, EMAIL_SCOPE],
  },
} as const satisfies Record<string, Route>

/** Matches the `{name}` parts of a path template. */
const TEMPLATE_PARAM_PATTERN = /\{([^{}]+)\}/g

/** Matches a control character, which no path value may hold. */
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u

function templateParams(path: string): string[] {
  return [...path.matchAll(TEMPLATE_PARAM_PATTERN)].map((match) => match[1] ?? "")
}

function badParam(route: Route, name: string, problem: string): ToolError {
  return new ToolError("invalid_argument", `The path parameter "${name}" of ${route.path} ${problem}.`)
}

function isUnsafeSegment(value: string): boolean {
  return (
    value === "" ||
    value === "." ||
    value.includes("/") ||
    value.includes("..") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  )
}

function checkParams(route: Route, params: Record<string, string>): void {
  const names = templateParams(route.path)
  for (const name of names) {
    const value = Object.hasOwn(params, name) ? params[name] : undefined
    if (typeof value !== "string") throw badParam(route, name, "is missing")
    if (isUnsafeSegment(value)) {
      throw badParam(route, name, `must not be empty, "." or hold "/", ".." or a control character`)
    }
  }
  const extra = Object.keys(params).find((name) => !names.includes(name))
  if (extra !== undefined)
    throw new ToolError("invalid_argument", `The route ${route.path} has no path parameter "${extra}".`)
}

/**
 * The URL of `route`: `https://<host><path>` with each `{name}` replaced by
 * the encoded value in `params`, then the `query`.
 *
 * A host outside `HOSTS` is `internal_error`. A missing or extra param, and a
 * value that is empty, `.`, or holds `/`, `..` or a control character, is
 * `invalid_argument`. Query entries that are `undefined` are left out and an
 * array repeats its key.
 */
export function routeUrl(
  route: Route,
  params: Record<string, string> = {},
  query: Record<string, QueryValue> = {},
): URL {
  if (!HOSTS.includes(route.host)) {
    throw new ToolError("internal_error", `${JSON.stringify(route.host)} is not a host the package may reach.`)
  }
  checkParams(route, params)
  const path = route.path.replace(TEMPLATE_PARAM_PATTERN, (_match, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  )
  const url = new URL(`https://${route.host}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (typeof value === "object") {
      for (const item of value) url.searchParams.append(key, item)
    } else {
      url.searchParams.append(key, String(value))
    }
  }
  return url
}
