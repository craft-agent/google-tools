import { ToolError } from "../errors"
import { pageToken } from "./ids"

/** What each list method returns when `limit` is left out (`standard`), and the most it returns. */
export const LIMITS = {
  search: { standard: 10, max: 50 },
  playlist: { standard: 25, max: 50 },
  comments: { standard: 20, max: 100 },
} as const

/** The most any method returns: what the `limit` argument allows before the method's own maximum applies. */
export const MAX_LIMIT = Math.max(...Object.values(LIMITS).map((limit) => limit.max))

export type LimitedMethod = keyof typeof LIMITS

/** The page a list call asks for: its size and the token of the page, when it is not the first. */
export type Page = { maxResults: number; pageToken: string | undefined }

/** The page `limit` and `token` ask of `method`; a limit beyond its maximum or a token not shaped as Google's is `invalid_argument`. */
export function pageOf(method: LimitedMethod, limit: number | undefined, token: string | undefined): Page {
  const { standard, max } = LIMITS[method]
  const maxResults = limit ?? standard
  if (maxResults > max) {
    throw new ToolError("invalid_argument", `Method ${method} takes a \`limit\` of 1 to ${max}.`)
  }
  return { maxResults, pageToken: token === undefined ? undefined : pageToken(token) }
}
