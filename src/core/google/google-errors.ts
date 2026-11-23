import { ToolError, type ErrorCode, type ErrorDetails } from "../errors"

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_PRECONDITION_FAILED = 412
const HTTP_TOO_MANY_REQUESTS = 429

/** The OAuth error of a refresh token that was revoked or has expired. */
export const INVALID_GRANT = "invalid_grant"

/** The OAuth error of a revoke for a token that is already revoked or has expired. */
export const INVALID_TOKEN = "invalid_token"

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

/** The `@type` suffix of the `error.details` entry that lists the arguments a 400 refused. */
const BAD_REQUEST_TYPE_SUFFIX = "google.rpc.BadRequest"

/** The most field violations a message repeats. */
const MAX_VIOLATIONS = 3

/** The longest violation a message repeats, in characters. */
const MAX_VIOLATION_LENGTH = 200

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

/** `field: description`, or the description alone when Google names no field; nothing when it gives no description. */
function violationOf(entry: unknown): string[] {
  if (!isRecord(entry)) return []
  const description = textOf(entry.description)
  if (description === undefined) return []
  const field = textOf(entry.field)
  return [(field === undefined ? description : `${field}: ${description}`).slice(0, MAX_VIOLATION_LENGTH)]
}

/** The violations of every `google.rpc.BadRequest` entry of `error.details`, in order. */
function violationsOf(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return details.flatMap((entry) => {
    if (!isRecord(entry) || !textOf(entry["@type"])?.endsWith(BAD_REQUEST_TYPE_SUFFIX)) return []
    return Array.isArray(entry.fieldViolations) ? entry.fieldViolations.flatMap(violationOf) : []
  })
}

/** Google's message, followed by the field violations it lists, when there are any. */
function messageOf(error: Record<string, unknown>): string | undefined {
  const message = textOf(error.message)
  const violations = violationsOf(error.details).slice(0, MAX_VIOLATIONS)
  if (message === undefined || violations.length === 0) return message
  return `${message} (${violations.join("; ")})`
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
    message: messageOf(error),
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
 * to `HTTP <status>`. When the reply lists field violations
 * (`error.details[]` of type `google.rpc.BadRequest`), the message goes on with
 * the first three in parentheses, `field: description` each cut to 200
 * characters, which says which argument Google refused. `details` holds
 * `status` and, when Google gave them, `reason` (the first) and `google_status`.
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
