import { ToolError } from "../errors"

/** The OAuth client of a Google Cloud project: what a login and a refresh present to Google. */
export type OAuthClient = {
  client_id: string
  client_secret: string
}

/** The fields of an `installed` client that are non-empty strings. */
const CLIENT_FIELDS = ["client_id", "client_secret"] as const

function notClientFile(what: string, problem: string): ToolError {
  return new ToolError("invalid_argument", `${what} is not a Google OAuth client file: ${problem}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // The parser's message can quote the input, so it is dropped.
    throw notClientFile(what, "the text is not valid JSON")
  }
}

/**
 * Parses the JSON file the Google Cloud console downloads for a Desktop app
 * client, `{"installed": {"client_id": …, "client_secret": …, …}}`, and returns
 * the client's id and secret. A Web application client (a `web` key) is refused
 * with the way to get the right one. Anything else that is wrong throws
 * `invalid_argument` naming the field, never a value and never the text.
 */
export function parseClientFile(text: string, what: string): OAuthClient {
  const data = parseJson(text, what)
  if (!isRecord(data)) throw notClientFile(what, "it is not a JSON object")
  const installed = data.installed
  if (installed === undefined && data.web !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `${what} is a Web application client; create a Desktop app client and download its JSON.`,
    )
  }
  if (!isRecord(installed)) throw notClientFile(what, 'it has no "installed" object, which a Desktop app client has')
  const client = { client_id: installed.client_id, client_secret: installed.client_secret }
  for (const field of CLIENT_FIELDS) {
    if (typeof client[field] !== "string" || client[field] === "") {
      throw notClientFile(what, `installed.${field} must be a non-empty string`)
    }
  }
  return client as OAuthClient
}
