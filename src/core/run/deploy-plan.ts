import { ToolError } from "../errors"
import type { ToolContext } from "../tool"
import type { ChangeRequest, ChangeSession } from "./change"
import type { ContainerView } from "./container-view"
import type { RunDeployArgs } from "./deploy-args"
import { newTemplate, updatedTemplate } from "./deploy-template"
import { imageRepository } from "./image"
import { readIfFound } from "./resource-state"
import { RUN_ROUTES } from "./routes"
import { readServiceState } from "./service-state"
import type { ServiceView } from "./service-view"
import { checkedService } from "./target"
import { runWriteSession } from "./write-session"

/** A deploy planned: what is sent and what the service was before. */
export type DeployPlan = ChangeSession & {
  label: string
  service: string
  args: RunDeployArgs
  /** `create` when the service did not exist, else `update`. */
  mode: "create" | "update"
  request: ChangeRequest
  /** The service as it was read, with no environment value; `null` when it did not exist. */
  before: ServiceView | null
  /** The service's etag, which the write sends; `null` when there is none. */
  etag: string | null
  /** The container the call changes, as it was read; `null` when the service did not exist. */
  container: ContainerView | null
}

/** Refuses a minimum above the maximum when a call gives both. */
function checkInstanceRange({ min_instances, max_instances }: RunDeployArgs): void {
  if (min_instances !== undefined && max_instances !== undefined && min_instances > max_instances) {
    throw new ToolError(
      "invalid_argument",
      `\`min_instances\` (${min_instances}) is above \`max_instances\` (${max_instances}); nothing was changed.`,
    )
  }
}

/**
 * Checks the arguments (the ids, the image against the project's own
 * registry, the instance range) and the label's scopes before anything is
 * read, then reads the service: one that does not exist is created from the
 * call, one that does is updated by changing a copy of its template.
 */
export async function planDeploy(args: RunDeployArgs, ctx: ToolContext): Promise<DeployPlan> {
  const { place, service } = checkedService(args)
  imageRepository(args.image, place.project)
  checkInstanceRange(args)
  const { client, label, runtime } = await runWriteSession(ctx, args.account, RUN_ROUTES.servicePatch)
  const base = { client, runtime, place, label, service, args }
  const state = await readIfFound(() => readServiceState(client, place, service))

  if (state === undefined) {
    const request: ChangeRequest = {
      route: RUN_ROUTES.serviceCreate,
      params: place,
      query: { serviceId: service },
      body: { template: newTemplate(args) },
    }
    return { ...base, mode: "create", request, before: null, etag: null, container: null }
  }

  const { template, index } = updatedTemplate(state.raw.template, args)
  const request: ChangeRequest = {
    route: RUN_ROUTES.servicePatch,
    params: { ...place, service },
    query: { updateMask: "template", forceNewRevision: true },
    body: { template, ...(state.etag !== null && { etag: state.etag }) },
  }
  const container = state.view.template.containers[index] ?? null
  return { ...base, mode: "update", request, before: state.view, etag: state.etag, container }
}
