import { ToolError, isToolError } from "../errors"

const HTTP_BAD_REQUEST = 400

/** What Google's message starts with when a range it was asked to read names no tab or is no range. */
const UNPARSABLE_RANGE = "Unable to parse range"

/** The message of a failed Google call, which is `<subject>: <Google's text>`. */
const UNPARSABLE_RANGE_MESSAGE = new RegExp(`^[^:]*: ${UNPARSABLE_RANGE}`)

/**
 * Runs `read`, which sends the ranges the caller gave to Google. Google's 400
 * for a range it cannot parse is a mistake of the caller's, so it is
 * `invalid_argument` with Google's text, as a write's range is; any other
 * failure goes on as it is.
 */
export async function readingRanges<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (
      isToolError(error) &&
      error.code === "upstream_error" &&
      error.details?.status === HTTP_BAD_REQUEST &&
      UNPARSABLE_RANGE_MESSAGE.test(error.message)
    ) {
      throw new ToolError("invalid_argument", error.message, { cause: error })
    }
    throw error
  }
}
