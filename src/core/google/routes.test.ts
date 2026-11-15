import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { EMAIL_SCOPE, HOSTS, OAUTH_ROUTES, OPENID_SCOPE, routeUrl, type Route } from "./routes"

const FILE_ROUTE: Route = {
  method: "GET",
  host: "oauth2.googleapis.com",
  path: "/v1/files/{file_id}/revisions/{revision}",
  scopes: [],
}

function failureOf(run: () => unknown): ToolError {
  try {
    run()
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error("expected a ToolError")
}

describe("OAUTH_ROUTES", () => {
  test("names the OAuth endpoints and their scopes", () => {
    expect(routeUrl(OAUTH_ROUTES.authorize).toString()).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(OAUTH_ROUTES.authorize.scopes).toEqual([])
    expect(routeUrl(OAUTH_ROUTES.token).toString()).toBe("https://oauth2.googleapis.com/token")
    expect(routeUrl(OAUTH_ROUTES.revoke).toString()).toBe("https://oauth2.googleapis.com/revoke")
    expect(routeUrl(OAUTH_ROUTES.userinfo).toString()).toBe("https://openidconnect.googleapis.com/v1/userinfo")
    expect(OAUTH_ROUTES.token.scopes).toEqual([])
    expect(OAUTH_ROUTES.userinfo.scopes).toEqual([OPENID_SCOPE, EMAIL_SCOPE])
    expect(OPENID_SCOPE).toBe("openid")
    expect(EMAIL_SCOPE).toBe("https://www.googleapis.com/auth/userinfo.email")
  })

  test("every route sits on an allowed host", () => {
    for (const route of Object.values(OAUTH_ROUTES)) expect(HOSTS).toContain(route.host)
  })
})

describe("routeUrl", () => {
  test("fills each {name} with the encoded value", () => {
    const url = routeUrl(FILE_ROUTE, { file_id: "a b?#%", revision: "r1" })
    expect(url.pathname).toBe("/v1/files/a%20b%3F%23%25/revisions/r1")
    expect(url.search).toBe("")
    expect(url.host).toBe("oauth2.googleapis.com")
  })

  test("adds the query: skips undefined, repeats arrays, writes numbers and booleans", () => {
    const url = routeUrl(OAUTH_ROUTES.userinfo, {}, { a: "x y", skip: undefined, n: 5, b: false, many: ["1", "2"] })
    expect(url.search).toBe("?a=x+y&n=5&b=false&many=1&many=2")
  })

  test("refuses a host that is not allowed as internal_error", () => {
    const error = failureOf(() => routeUrl({ ...FILE_ROUTE, host: "example.test" }, { file_id: "a", revision: "b" }))
    expect(error.code).toBe("internal_error")
  })

  test("refuses a missing param", () => {
    const error = failureOf(() => routeUrl(FILE_ROUTE, { file_id: "a" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"revision"')
  })

  test("refuses an extra param", () => {
    const error = failureOf(() => routeUrl(FILE_ROUTE, { file_id: "a", revision: "b", other: "c" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"other"')
  })

  test("refuses a param on a route that has none", () => {
    expect(failureOf(() => routeUrl(OAUTH_ROUTES.token, { id: "a" })).code).toBe("invalid_argument")
  })

  test.each([
    ["empty", ""],
    ["a dot", "."],
    ["a slash", "a/b"],
    ["dot dot", ".."],
    ["dot dot inside", "a..b"],
    ["a newline", "a\nb"],
    ["a NUL", "a\u0000b"],
    ["a DEL", "a\u007fb"],
  ])("refuses a value that is %s", (_name, value) => {
    expect(failureOf(() => routeUrl(FILE_ROUTE, { file_id: value, revision: "r" })).code).toBe("invalid_argument")
  })

  test("a refusal does not show the value", () => {
    const error = failureOf(() => routeUrl(FILE_ROUTE, { file_id: "secretValue/../x", revision: "r" }))
    expect(error.message).not.toContain("secretValue")
  })

  test("a param that is inherited, not given, is missing", () => {
    const params = Object.create({ file_id: "a", revision: "b" }) as Record<string, string>
    expect(failureOf(() => routeUrl(FILE_ROUTE, params)).code).toBe("invalid_argument")
  })
})
