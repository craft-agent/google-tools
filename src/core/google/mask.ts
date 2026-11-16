import { ToolError, type ErrorDetails } from "../errors"

/** What every credential found in a text is replaced with. */
export const MASK = "[masked]"

/** Patterns of what a Google credential looks like; each is built per call, so none carries `lastIndex` state. */
const CREDENTIAL_SHAPES: readonly { source: string; replacement: string }[] = [
  { source: "1//[0-9A-Za-z_-]{20,}", replacement: MASK },
  { source: "ya29\\.[0-9A-Za-z_.-]{20,}", replacement: MASK },
  { source: "GOCSPX-[0-9A-Za-z_-]{10,}", replacement: MASK },
  { source: "AIza[0-9A-Za-z_-]{35}", replacement: MASK },
  { source: "code=4/[0-9A-Za-z_-]{10,}", replacement: `code=${MASK}` },
]

/**
 * Replaces with `[masked]` every non-empty value of `known`, longest first so
 * a value inside a longer one leaves no remainder; nothing else is changed.
 */
export function maskKnown(text: string, known: readonly string[] = []): string {
  const longestFirst = [...new Set(known.filter((value) => value !== ""))].sort((a, b) => b.length - a.length)
  return longestFirst.reduce((masked, value) => masked.split(value).join(MASK), text)
}

/**
 * `maskKnown`, then replaces anything shaped like a Google credential:
 * refresh, access and client secrets, API keys and the authorization code of
 * a query.
 */
export function maskText(text: string, known: readonly string[] = []): string {
  return CREDENTIAL_SHAPES.reduce(
    (masked, shape) => masked.replace(new RegExp(shape.source, "g"), shape.replacement),
    maskKnown(text, known),
  )
}

/**
 * A deep copy of JSON-like `value` with every string, object keys included,
 * passed through `maskText`. A string held by a top-level key of `saved` is
 * passed through `maskKnown` only, since shape masking would corrupt content
 * such as base64.
 */
export function maskValue<T>(value: T, known: readonly string[] = [], saved: readonly string[] = []): T {
  if (saved.length > 0 && value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskText(key, known),
        typeof item === "string" && saved.includes(key) ? maskKnown(item, known) : maskAny(item, known),
      ]),
    ) as T
  }
  return maskAny(value, known) as T
}

function maskAny(value: unknown, known: readonly string[]): unknown {
  if (typeof value === "string") return maskText(value, known)
  if (Array.isArray(value)) return value.map((item) => maskAny(item, known))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [maskText(key, known), maskAny(item, known)]))
  }
  return value
}

/**
 * The error with its message, and a `ToolError`'s details, masked: a new
 * `ToolError` with the same code, a new `Error` for any other error, anything
 * else unchanged. The original object comes back when there was nothing to mask.
 */
export function maskError(error: unknown, known: readonly string[] = []): unknown {
  if (!(error instanceof Error)) return error
  const message = maskText(error.message, known)
  if (error instanceof ToolError) {
    const details = error.details === undefined ? undefined : maskValue(error.details, known)
    const detailsChanged = JSON.stringify(details) !== JSON.stringify(error.details)
    if (message === error.message && !detailsChanged) return error
    // The cause is dropped: it is the unmasked error.
    return new ToolError(error.code, message, { details: details as ErrorDetails | undefined })
  }
  return message === error.message ? error : new Error(message)
}
