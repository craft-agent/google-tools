import { defineTool, type ToolContext } from "../tool"
import { operationReport, sendChange } from "./change"
import type { WaitOptions } from "./operation-wait"
import { describeRevisionDelete } from "./revision-delete-describe"
import {
  runRevisionDeleteInput,
  runRevisionDeleteOutput,
  type RunRevisionDeleteArgs,
  type RunRevisionDeleteResult,
} from "./revision-delete-args"
import { planRevisionDelete } from "./revision-delete-plan"
import { RUN_TOOLSET } from "./scopes"
import { revisionTargets } from "./target"

/** Deletes the revision and waits for the operation; `wait` is for tests. */
export async function deleteRevision(
  args: RunRevisionDeleteArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunRevisionDeleteResult> {
  const plan = await planRevisionDelete(args, ctx)
  const outcome = await sendChange(plan, plan.request, ctx.signal, wait)
  return { revision: plan.revision, deleted: outcome.done, operation: operationReport(outcome) }
}

export const googleRunRevisionDelete = defineTool({
  id: "google_run_revision_delete",
  title: "Delete Cloud Run revision",
  intent: "About to delete a Cloud Run revision",
  description:
    "Delete one revision of a Cloud Run service, named by `project`, `region`, `service` and `revision` (short names, as `google_run_read` lists them). " +
    "A deleted revision can no longer take traffic back, and the deletion cannot be undone. " +
    "A revision that still matters to the service's traffic is refused, and nothing is deleted: one that takes a share of the traffic as set or as served, carries a tag (its URL would stop working), or is the latest ready revision while traffic goes to the latest. Move the traffic first with `google_run_traffic_set`. " +
    "The deletion is sent with the etag it read, so a revision that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns the `revision`, `deleted` and the `operation`; `deleted: false` means Google is still deleting, so follow it with `google_run_read` method `operation`. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "administrative",
  input: runRevisionDeleteInput,
  output: runRevisionDeleteOutput,
  targets: (args, ctx) => revisionTargets(args, ctx),
  async describe(args, ctx) {
    return describeRevisionDelete(await planRevisionDelete(args, ctx))
  },
  execute: (args, ctx) => deleteRevision(args, ctx),
})
