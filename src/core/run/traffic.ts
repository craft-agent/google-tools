import { defineTool, type ToolContext } from "../tool"
import type { WaitOptions } from "./operation-wait"
import { RUN_TOOLSET } from "./scopes"
import { changedService, sendChange } from "./service-change"
import { serviceTargets } from "./target"
import {
  MAX_TRAFFIC_ENTRIES,
  runTrafficInput,
  runTrafficOutput,
  type RunTrafficArgs,
  type RunTrafficResult,
} from "./traffic-args"
import { describeTraffic } from "./traffic-describe"
import { planTraffic } from "./traffic-plan"

/** Sets the service's traffic and waits for the operation; `wait` is for tests. */
export async function setTraffic(
  args: RunTrafficArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunTrafficResult> {
  const plan = await planTraffic(args, ctx)
  const outcome = await sendChange(plan, plan.request, ctx.signal, wait)
  const { traffic, traffic_statuses } = plan.before
  return {
    service: changedService(outcome),
    before: { traffic, traffic_statuses },
    operation: { operation: outcome.operation, done: outcome.done },
  }
}

export const googleRunTrafficSet = defineTool({
  id: "google_run_traffic_set",
  title: "Set Cloud Run traffic",
  intent: "About to change a Cloud Run service's traffic",
  description:
    "Set how a Cloud Run service's requests are split between its revisions, named by `project`, `region` and `service` (short names, as `google_run_read` lists them). " +
    `\`traffic\` is the whole new split (1 to ${MAX_TRAFFIC_ENTRIES} entries), replacing the one the service has: each entry gives one \`revision\` (its short name) or \`latest: true\` (the latest ready revision), a \`percent\` (0 to 100) and optionally a \`tag\` that gives the target its own URL. The percents must add up to exactly 100, and no revision, \`latest\` or tag is given twice. A revision or tag left out of the split no longer takes traffic or has its URL. ` +
    "This takes requests from the revisions that served them, so it overwrites the split; to undo it, call it again with the split in `before.traffic`. " +
    "The deploy tool decides what a new revision gets; this one moves traffic between revisions that exist. " +
    "The change is sent with the etag it read, so a service that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns the `service` as it is once the change is done (null while the operation is still running), `before` (the `traffic` set and the `traffic_statuses` served) and the `operation`; with `done: false` the change is still running, so follow it with `google_run_read` method `operation` before trying again. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "overwrite",
  input: runTrafficInput,
  output: runTrafficOutput,
  targets: (args, ctx) => serviceTargets(args, ctx),
  async describe(args, ctx) {
    return describeTraffic(await planTraffic(args, ctx))
  },
  execute: (args, ctx) => setTraffic(args, ctx),
})
