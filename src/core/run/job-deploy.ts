import { defineTool, type ToolContext } from "../tool"
import { beforeChange, changed, operationReport, sendChange } from "./change"
import { imageBound, imageRepository } from "./image"
import {
  runJobDeployInput,
  runJobDeployOutput,
  type RunJobDeployArgs,
  type RunJobDeployResult,
} from "./job-deploy-args"
import { describeJobDeploy } from "./job-deploy-describe"
import { planJobDeploy, type JobDeployPlan } from "./job-deploy-plan"
import { jobReply, jobView } from "./job-view"
import type { OperationOutcome, WaitOptions } from "./operation-wait"
import { RUN_ROUTES } from "./routes"
import { RUN_TOOLSET } from "./scopes"
import { jobTargets } from "./target"

/** The result of a job deploy: what the call did, the job once the operation is done and what it was before. */
function jobDeployResult(plan: JobDeployPlan, outcome: OperationOutcome): RunJobDeployResult {
  return {
    created: plan.mode === "create",
    job: changed(outcome, jobReply, jobView),
    before: beforeChange(plan.before, plan.container),
    operation: operationReport(outcome),
  }
}

/** Deploys the call's image, creating the job or replacing it, and waits for the operation; `wait` is for tests. */
export async function deployJob(
  args: RunJobDeployArgs,
  ctx: ToolContext,
  wait?: WaitOptions,
): Promise<RunJobDeployResult> {
  const plan = await planJobDeploy(args, ctx)
  return jobDeployResult(plan, await sendChange(plan, plan.request, ctx.signal, wait))
}

export const googleRunJobDeploy = defineTool({
  id: "google_run_job_deploy",
  title: "Deploy Cloud Run job",
  intent: "About to deploy a Cloud Run job",
  description:
    "Deploy a container `image` to a Cloud Run job, named by `project`, `region` and `job` (short names, as `google_run_read` lists them). The image must come from the project's own registry: `<location>-docker.pkg.dev/<project>/…`, `gcr.io/<project>/…` or `<us|eu|asia>.gcr.io/<project>/…`, with an optional tag or digest; any other (Docker Hub, `ghcr.io`, another project's registry) is refused before anyone is asked, since it would run someone else's code with the job's identity. " +
    "A job that does not exist is created, with Google's defaults: the default service account and no VPC access; nothing about who may run it is set. " +
    "On a job that exists, the job is replaced by a copy of itself with only the changes given; the next execution runs them, and executions already running are not touched. " +
    "Optional changes (everything left out keeps its value): `container` (needed when the job has several), `env` (a string sets a plain variable, `null` removes one; a variable that references a secret is refused), `command`, `args`, `cpu`, `memory`, `timeout_seconds` (per task), `task_count`, `parallelism` (at most `task_count` when both are given) and `max_retries`. " +
    "The service account, network, secrets, volumes, labels and who may run the job are never changed and are kept as they are. " +
    "The deploy sends the etag it read, so a job that changed meanwhile fails as `stale`; read it again and retry. " +
    "It waits up to two minutes for Google's operation. Returns `created`, the `job` (null while the operation is still running), `before` (the changed container's image and the task template as it was, null for a new job) and the `operation`; with `done: false` the change is still running, so follow it with `google_run_read` method `operation` before trying again. " +
    "A failed operation is an error that says to read the job to see what was left. " +
    "No environment value is ever returned: variables are given by name and kind. " +
    "`account` is needed when several accounts are set up.",
  toolset: RUN_TOOLSET,
  class: "overwrite",
  input: runJobDeployInput,
  output: runJobDeployOutput,
  gate: ({ image, project }) => {
    imageRepository(image, project)
  },
  bounds: { image: imageBound },
  measure: ({ image, project }) => ({ image: imageRepository(image, project) }),
  targets: (args, ctx) => jobTargets(args, ctx, RUN_ROUTES.jobPatch),
  async describe(args, ctx) {
    return describeJobDeploy(await planJobDeploy(args, ctx))
  },
  execute: (args, ctx) => deployJob(args, ctx),
})
