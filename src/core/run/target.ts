import type { ToolContext } from "../tool"
import type { Place } from "./calls"
import { projectId, regionId, resourceName } from "./ids"
import { RUN_ROUTES } from "./routes"
import { runWriteSession } from "./write-session"

/** The target of a write to a Cloud Run resource: the label, the project and region, then the resource's path (`services`, `api`). */
export function runTarget(label: string, place: Place, ...segments: string[]): string {
  return [label, "projects", place.project, "locations", place.region, ...segments].join("/")
}

/** The place and the service a call names, each checked as the id it must be; `invalid_argument` otherwise. */
export function checkedService(args: { project: string; region: string; service: string }): {
  place: Place
  service: string
} {
  return {
    place: { project: projectId(args.project), region: regionId(args.region) },
    service: resourceName(args.service, "service name"),
  }
}

/** The one target of a write to a service and its traffic: the ids are checked first, then the label's scopes. */
export async function serviceTargets(
  args: { account?: string; project: string; region: string; service: string },
  ctx: ToolContext,
): Promise<string[]> {
  const { place, service } = checkedService(args)
  const { label } = await runWriteSession(ctx, args.account, RUN_ROUTES.servicePatch)
  return [runTarget(label, place, "services", service)]
}
