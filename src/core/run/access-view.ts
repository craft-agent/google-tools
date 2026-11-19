import { z } from "zod"
import { shortName, shortNameOrNull } from "./names"

/** The members that make a resource reachable by people outside the project. */
const PUBLIC_MEMBERS = ["allUsers", "allAuthenticatedUsers"]

/** The path segments of an operation's resource name, in the order they are tried, and the kind each says. */
const RESOURCE_KINDS = [
  ["/revisions/", "revision"],
  ["/executions/", "execution"],
  ["/jobs/", "job"],
  ["/services/", "service"],
] as const

/** An IAM policy as Google gives it; the etag and the version are left out of the parse. */
export const policyReply = z.object({
  bindings: z
    .array(
      z.object({
        role: z.string().optional(),
        members: z.array(z.string()).optional(),
        condition: z.object({ title: z.string().optional(), expression: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

/** An operation as Google gives it; the `metadata` and `response` bodies are never copied, only the resource's name in `metadata`. */
export const operationReply = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
  metadata: z.object({ name: z.unknown().optional() }).optional(),
})

export const bindingSchema = z.object({
  role: z.string(),
  members: z.array(z.string()),
  condition: z.object({ title: z.string().nullable(), expression: z.string() }).nullable(),
})

export const operationSchema = z.object({
  operation: z.string(),
  done: z.boolean(),
  error: z.object({ code: z.number(), message: z.string() }).nullable(),
  resource: z.string().nullable(),
  resource_kind: z.enum(["service", "job", "execution", "revision"]).nullable(),
})

export type PolicyReply = z.infer<typeof policyReply>
export type OperationReply = z.infer<typeof operationReply>
export type BindingView = z.infer<typeof bindingSchema>
export type OperationView = z.infer<typeof operationSchema>

/** A policy's bindings, and whether `allUsers` or `allAuthenticatedUsers` is among any binding's members; never its etag. */
export function policyView(reply: PolicyReply): { bindings: BindingView[]; public: boolean } {
  const bindings = (reply.bindings ?? []).map((binding) => ({
    role: binding.role ?? "",
    members: binding.members ?? [],
    condition:
      binding.condition === undefined
        ? null
        : { title: binding.condition.title ?? null, expression: binding.condition.expression ?? "" },
  }))
  return {
    bindings,
    public: bindings.some((binding) => binding.members.some((member) => PUBLIC_MEMBERS.includes(member))),
  }
}

/** An operation's state, error and the resource it changes, never its metadata or response body. */
export function operationView(reply: OperationReply): OperationView {
  const resourceName = typeof reply.metadata?.name === "string" ? reply.metadata.name : undefined
  const kind = RESOURCE_KINDS.find(([segment]) => resourceName?.includes(segment))
  return {
    operation: shortName(reply.name),
    done: reply.done ?? false,
    error: reply.error === undefined ? null : { code: reply.error.code ?? 0, message: reply.error.message ?? "" },
    resource: shortNameOrNull(resourceName),
    resource_kind: kind?.[1] ?? null,
  }
}
