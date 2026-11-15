import { describe, expect, test } from "bun:test"
import type { ErrorCode } from "../errors"
import { googleError } from "./google-errors"

function googleBody(status: number, message: string, googleStatus?: string, reasons: string[] = []) {
  return {
    error: {
      code: status,
      message,
      status: googleStatus,
      errors: reasons.map((reason) => ({ reason, message })),
    },
  }
}

describe("googleError mapping", () => {
  test.each([
    ["401", 401, googleBody(401, "bad", "UNAUTHENTICATED"), "unauthenticated"],
    ["401 with no body", 401, undefined, "unauthenticated"],
    ["OAuth invalid_grant", 400, { error: "invalid_grant", error_description: "Bad Request" }, "unauthenticated"],
    ["403 PERMISSION_DENIED", 403, googleBody(403, "no", "PERMISSION_DENIED"), "forbidden"],
    ["403 insufficientPermissions", 403, googleBody(403, "no", undefined, ["insufficientPermissions"]), "forbidden"],
    ["403 forbidden", 403, googleBody(403, "no", undefined, ["forbidden"]), "forbidden"],
    ["403 with no known reason", 403, googleBody(403, "no", undefined, ["accessNotConfigured"]), "upstream_error"],
    ["404", 404, googleBody(404, "gone"), "not_found"],
    ["404 NOT_FOUND", 404, googleBody(404, "gone", "NOT_FOUND"), "not_found"],
    ["412", 412, googleBody(412, "changed"), "stale"],
    ["400 FAILED_PRECONDITION", 400, googleBody(400, "changed", "FAILED_PRECONDITION"), "stale"],
    ["429", 429, googleBody(429, "slow"), "rate_limited"],
    ["RESOURCE_EXHAUSTED", 429, googleBody(429, "slow", "RESOURCE_EXHAUSTED"), "rate_limited"],
    ["403 rateLimitExceeded", 403, googleBody(403, "slow", undefined, ["rateLimitExceeded"]), "rate_limited"],
    ["403 userRateLimitExceeded", 403, googleBody(403, "slow", undefined, ["userRateLimitExceeded"]), "rate_limited"],
    ["403 dailyLimitExceeded", 403, googleBody(403, "slow", undefined, ["dailyLimitExceeded"]), "rate_limited"],
    ["500", 500, googleBody(500, "oops", "INTERNAL"), "upstream_error"],
    ["400", 400, googleBody(400, "bad request", "INVALID_ARGUMENT"), "upstream_error"],
    ["OAuth invalid_client on 400", 400, { error: "invalid_client" }, "upstream_error"],
    ["a text body", 502, "<html>Bad gateway</html>", "upstream_error"],
    ["a null body", 503, null, "upstream_error"],
  ])("%s is %s", (_name, status, body, code) => {
    expect(googleError(status, body, "Google").code).toBe(code as ErrorCode)
  })
})

describe("googleError message and details", () => {
  test("the message is the subject and Google's message", () => {
    const error = googleError(403, googleBody(403, "Drive API has not been used.", "PERMISSION_DENIED"), "Google")
    expect(error.message).toBe("Google: Drive API has not been used.")
  })

  test("the message of an OAuth error joins the error and its description", () => {
    const error = googleError(400, { error: "invalid_grant", error_description: "Token has been expired" }, "Google")
    expect(error.message).toBe("Google: invalid_grant: Token has been expired")
    expect(error.details).toEqual({ status: 400, reason: "invalid_grant" })
  })

  test("an OAuth error with no description is the error alone", () => {
    expect(googleError(400, { error: "invalid_request" }, "Google").message).toBe("Google: invalid_request")
  })

  test.each([
    ["a text body", "plain text"],
    ["null", null],
    ["an empty object", {}],
    ["an error with no message", { error: { code: 500 } }],
    ["an array", []],
  ])("falls back to the status for %s", (_name, body) => {
    expect(googleError(502, body, "Google").message).toBe("Google: HTTP 502")
  })

  test("details hold the status, the first reason and Google's status", () => {
    const body = googleBody(403, "no", "PERMISSION_DENIED", ["forbidden", "other"])
    expect(googleError(403, body, "Google").details).toEqual({
      status: 403,
      reason: "forbidden",
      google_status: "PERMISSION_DENIED",
    })
  })

  test("details hold only the status when Google gave nothing else", () => {
    expect(googleError(500, "oops", "Google").details).toEqual({ status: 500 })
  })

  test("a reason in error.details counts when error.errors has none", () => {
    const body = { error: { message: "slow", details: [{ "@type": "x", reason: "rateLimitExceeded" }] } }
    const error = googleError(403, body, "Google")
    expect(error.code).toBe("rate_limited")
    expect(error.details).toEqual({ status: 403, reason: "rateLimitExceeded" })
  })

  test("the text is Google's own and is not masked here", () => {
    const error = googleError(400, { error: { message: "token ya29.fake-access-token-0000000000000001" } }, "Google")
    expect(error.message).toContain("ya29.fake-access-token-0000000000000001")
  })
})
