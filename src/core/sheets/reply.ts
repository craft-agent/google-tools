import type { z } from "zod"
import { ToolError } from "../errors"

/** `reply` as `schema` reads it, or `upstream_error` when Google's answer is not the shape the tool relies on. */
export function parseReply<S extends z.ZodType>(schema: S, reply: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(reply)
  if (!parsed.success) {
    throw new ToolError("upstream_error", `Google's reply to ${what} was not in the expected shape.`)
  }
  return parsed.data
}
