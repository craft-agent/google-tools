import { ToolError } from "../errors"

/** The error of a call its caller cancelled. */
export function cancelledError(): ToolError {
  return new ToolError("upstream_error", "The call was cancelled.")
}
