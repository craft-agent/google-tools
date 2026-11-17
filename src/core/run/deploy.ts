import { defineTool, type ToolContext } from "../tool"
import { runDeployInput, runDeployOutput, type RunDeployArgs, type RunDeployResult } from "./deploy-args"
import { describeDeploy } from "./deploy-describe"
import { planDeploy, type DeployPlan } from "./deploy-plan"
import { imageBound, imageRepository } from "./image"
import type { OperationOutcome, WaitOptions } from "./operation-wait"
import { changedService, sendChange } from "./service-change"
import { serviceTargets } from "./target"
import { RUN_TOOLSET } from "./scopes"

/** The result of a deploy: what the call did, the service once the operation is done and what it was before. */
function deployResult(plan: DeployPlan, outcome: OperationOutcome): RunDeployResult {
  const service = changedService(outcome)
  const { before, container } = plan
  return {
    created: plan.mode === "create",
    service,
    revision: service?.latest_created_revision ?? null,
    before: before !== null && container !== null ? { image: container.image, template: before.template } : null,
    operation: { operation: outcome.operation, done: outcome.done },
  }
}

/** Deploys the call's image, creating the service or replacing the running revision, and waits for the operation; `wait` is for tests. */
export async function deployService(
  args: RunDeployArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunDeployResult> {
  const plan = await planDeploy(args, ctx)
  return deployResult(plan, await sendChange(plan, plan.request, ctx.signal, wait))
}

export const googleRunServiceDeploy = defineTool({
  id: "google_run_service_deploy",
  title: "Deploy Cloud Run service",
  intent: "About to deploy a Cloud Run service",
  description:
    "Deploy a container `image` to a Cloud Run service, named by `project`, `region` and `service` (short names, as `google_run_read` lists them). The image must come from the project's own registry: `<location>-docker.pkg.dev/<project>/…`, `gcr.io/<project>/…` or `<us|eu|asia>.gcr.io/<project>/…`, with an optional tag or digest; any other (Docker Hub, `ghcr.io`, another project's registry) is refused before anyone is asked, since it would run someone else's code with the service's identity. " +
    "A service that does not exist is created, with Google's defaults: authentication required, the default service account and the default ingress; nothing about who may reach it is set. " +
    "On a service that exists, the running revision's image and settings are replaced: a new revision is made from a copy of the service's template with only the changes given, and it takes all the traffic when the service follows its latest revision, none when the traffic is pinned to revisions (then use `google_run_traffic_set`). " +
    "Optional changes (everything left out keeps its value): `container` (needed when the service has several), `env` (a string sets a plain variable, `null` removes one; a variable that references a secret is refused), `command`, `args`, `cpu`, `memory`, `min_instances`, `max_instances`, `timeout_seconds`, `concurrency` and `port`. " +
    "The service account, ingress, network, secrets, volumes and who may invoke the service are never changed and are kept as they are. " +
    "The deploy sends the etag it read, so a service that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns `created`, the `service` and the `revision` made (both null while the operation is still running), `before` (the changed container's image and the template as it was, null for a new service) and the `operation`; with `done: false` the change is still running, so follow it with `google_run_read` method `operation` before trying again. " +
    "A failed operation is an error that says to read the service to see what was left. " +
    "No environment value is ever returned: variables are given by name and kind. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "overwrite",
  input: runDeployInput,
  output: runDeployOutput,
  gate: ({ image, project }) => {
    imageRepository(image, project)
  },
  bounds: { image: imageBound },
  measure: ({ image, project }) => ({ image: imageRepository(image, project) }),
  targets: (args, ctx) => serviceTargets(args, ctx),
  async describe(args, ctx) {
    return describeDeploy(await planDeploy(args, ctx))
  },
  execute: (args, ctx) => deployService(args, ctx),
})
