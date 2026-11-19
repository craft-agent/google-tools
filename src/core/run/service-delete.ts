import { defineTool, type ToolContext } from "../tool"
import { operationReport, sendChange } from "./change"
import type { WaitOptions } from "./operation-wait"
import { RUN_TOOLSET } from "./scopes"
import {
  runServiceDeleteInput,
  runServiceDeleteOutput,
  type RunServiceDeleteArgs,
  type RunServiceDeleteResult,
} from "./service-delete-args"
import { describeServiceDelete } from "./service-delete-describe"
import { planServiceDelete } from "./service-delete-plan"
import { serviceTargets } from "./target"

/** Deletes the service and waits for the operation; `wait` is for tests. */
export async function deleteService(
  args: RunServiceDeleteArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunServiceDeleteResult> {
  const plan = await planServiceDelete(args, ctx)
  const outcome = await sendChange(plan, plan.request, ctx.signal, wait)
  return { service: plan.service, deleted: outcome.done, operation: operationReport(outcome) }
}

export const googleRunServiceDelete = defineTool({
  id: "google_run_service_delete",
  title: "Delete Cloud Run service",
  intent: "About to delete a Cloud Run service",
  description:
    "Delete a Cloud Run service with every revision it has, named by `project`, `region` and `service` (short names, as `google_run_read` lists them). " +
    "Its URL stops working and the deletion cannot be undone. " +
    "The deletion is sent with the etag it read, so a service that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns the `service`, `deleted` and the `operation`; `deleted: false` means Google is still deleting, so follow it with `google_run_read` method `operation`. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "administrative",
  input: runServiceDeleteInput,
  output: runServiceDeleteOutput,
  targets: (args, ctx) => serviceTargets(args, ctx),
  async describe(args, ctx) {
    return describeServiceDelete(await planServiceDelete(args, ctx))
  },
  execute: (args, ctx) => deleteService(args, ctx),
})
