import type { z } from "zod"
import { isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { Route } from "../google/routes"
import { parseReply } from "../sheets/reply"

/**
 * A resource as a plan reads it: Google's own JSON, which a deploy copies from
 * and sends back and so must never be returned, the view of it that holds no
 * environment value, and the etag a write sends to prove what it was made from.
 */
export type ResourceState<View> = { raw: Record<string, unknown>; view: View; etag: string | null }

/** How a resource is read: the route that gets it with its path parameters, the schema of Google's reply, the view of it and what to call it in an error. */
export type ResourceRead<Reply extends z.ZodType, View> = {
  route: Route
  params: Record<string, string>
  reply: Reply
  view: (reply: z.output<Reply>) => View
  what: string
}

/** Reads one resource for a plan; one that is gone is `not_found`. */
export async function readResourceState<Reply extends z.ZodType, View>(
  client: GoogleClient,
  { route, params, reply, view, what }: ResourceRead<Reply, View>,
): Promise<ResourceState<View>> {
  const raw = await client.request<Record<string, unknown>>(route, { params })
  return { raw, view: view(parseReply(reply, raw, what)), etag: typeof raw.etag === "string" ? raw.etag : null }
}

/** The result of `read`, or `undefined` when the resource does not exist; any other failure passes. */
export async function readIfFound<State>(read: () => Promise<State>): Promise<State | undefined> {
  try {
    return await read()
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return undefined
    throw error
  }
}
