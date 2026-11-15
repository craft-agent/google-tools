import { ToolError, type ErrorCode, type ErrorDetails } from "../errors"

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_PRECONDITION_FAILED = 412
const HTTP_TOO_MANY_REQUESTS = 429

/** The OAuth error of a refresh token that was revoked or has expired. */
export const INVALID_GRANT = "invalid_grant"

const PERMISSION_DENIED = "PERMISSION_DENIED"
const NOT_FOUND = "NOT_FOUND"
const FAILED_PRECONDITION = "FAILED_PRECONDITION"
const RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED"

/** Reasons of a 403 that mean the caller lacks a permission. */
const FORBIDDEN_REASONS: ReadonlySet<string> = new Set(["insufficientPermissions", "forbidden"])

/** Reasons of a 403 that mean a quota was spent. */
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
])

/** What a failure body says, in either of Google's shapes. */
type Described = {
  message: string | undefined
  /** `error.status` of a Google JSON error, such as `PERMISSION_DENIED`. */
  googleStatus: string | undefined
  /** `error.errors[].reason` and `error.details[].reason`, or the OAuth `error`, in order. */
  reasons: string[]
  /** The OAuth `error` of a token endpoint failure. */
  oauthError: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function reasonsOf(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => (isRecord(entry) ? (textOf(entry.reason) ?? []) : []))
}

/** Reads `{error: {code, message, status, errors, details}}` and `{error, error_description}`; any other body says nothing. */
function describeBody(body: unknown): Described {
  const none: Described = { message: undefined, googleStatus: undefined, reasons: [], oauthError: undefined }
  if (!isRecord(body)) return none
  const { error } = body
  const oauthError = textOf(error)
  if (oauthError !== undefined) {
    const description = textOf(body.error_description)
    return {
      ...none,
      message: description === undefined ? oauthError : `${oauthError}: ${description}`,
      reasons: [oauthError],
      oauthError,
    }
  }
  if (!isRecord(error)) return none
  return {
    ...none,
    message: textOf(error.message),
    googleStatus: textOf(error.status),
    reasons: [...reasonsOf(error.errors), ...reasonsOf(error.details)],
  }
}

function codeOf(status: number, described: Described): ErrorCode {
  const { googleStatus, reasons, oauthError } = described
  const hasReason = (set: ReadonlySet<string>) => reasons.some((reason) => set.has(reason))
  if (status === HTTP_UNAUTHORIZED || oauthError === INVALID_GRANT) return "unauthenticated"
  if (status === HTTP_TOO_MANY_REQUESTS || googleStatus === RESOURCE_EXHAUSTED) return "rate_limited"
  if (status === HTTP_FORBIDDEN && hasReason(RATE_LIMIT_REASONS)) return "rate_limited"
  if (status === HTTP_FORBIDDEN && (googleStatus === PERMISSION_DENIED || hasReason(FORBIDDEN_REASONS))) {
    return "forbidden"
  }
  if (status === HTTP_NOT_FOUND || googleStatus === NOT_FOUND) return "not_found"
  if (status === HTTP_PRECONDITION_FAILED || googleStatus === FAILED_PRECONDITION) return "stale"
  return "upstream_error"
}

/**
 * The `ToolError` for a failed Google call: `status` is the HTTP status and
 * `body` the parsed reply, either Google's JSON error, an OAuth error or
 * anything else. The message is `<subject>: <Google's message>`, falling back
 * to `HTTP <status>`; `details` holds `status` and, when Google gave them,
 * `reason` (the first) and `google_status`.
 *
 * The text is Google's own and not masked; the caller masks it.
 */
export function googleError(status: number, body: unknown, subject: string): ToolError {
  const described = describeBody(body)
  const details: ErrorDetails = { status }
  const [reason] = described.reasons
  if (reason !== undefined) details.reason = reason
  if (described.googleStatus !== undefined) details.google_status = described.googleStatus
  return new ToolError(codeOf(status, described), `${subject}: ${described.message ?? `HTTP ${status}`}`, { details })
}
