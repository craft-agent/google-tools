import { isRecord } from "../describe"
import type { RunDeployArgs } from "./deploy-args"
import { changeContainer, newContainer, recordAt, refuseMasked, type Json } from "./container-change"
import { timeoutText } from "./timeout"

/** The scaling, timeout and concurrency a call gives, set on a template; the scaling keys it leaves out stay. */
function applyTemplate(template: Json, args: RunDeployArgs): void {
  if (args.min_instances !== undefined || args.max_instances !== undefined) {
    const scaling = recordAt(template, "scaling")
    if (args.min_instances !== undefined) scaling.minInstanceCount = args.min_instances
    if (args.max_instances !== undefined) scaling.maxInstanceCount = args.max_instances
  }
  if (args.timeout_seconds !== undefined) template.timeout = timeoutText(args.timeout_seconds)
  if (args.concurrency !== undefined) template.maxInstanceRequestConcurrency = args.concurrency
}

/** The template of a new service: one container holding what the call gives, and nothing else, so Google's defaults apply. A variable to remove is refused, since there is nothing to remove from. */
export function newTemplate(args: RunDeployArgs): Json {
  const template: Json = { containers: [newContainer(args, "service")] }
  applyTemplate(template, args)
  return template
}

/**
 * The template of an existing service with the call's changes, and the index
 * of the container changed. It is a copy of Google's own `template`, so every
 * field the call does not change, unknown ones included, is sent back as it
 * was; only `revision` is dropped, since a fixed name would clash with the new
 * revision. A template that holds a value the client masked (shaped like a
 * Google credential) is refused: sending it back would replace the value with
 * the mask.
 */
export function updatedTemplate(current: unknown, args: RunDeployArgs): { template: Json; index: number } {
  const template = structuredClone(isRecord(current) ? current : {})
  delete template.revision
  refuseMasked(template, "service")
  const index = changeContainer(template, args, "service")
  applyTemplate(template, args)
  return { template, index }
}
