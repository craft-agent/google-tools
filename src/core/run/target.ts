import type { Route } from "../google/routes"
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

/** The place and the job a call names, each checked as the id it must be; `invalid_argument` otherwise. */
export function checkedJob(args: { project: string; region: string; job: string }): { place: Place; job: string } {
  return {
    place: { project: projectId(args.project), region: regionId(args.region) },
    job: resourceName(args.job, "job name"),
  }
}

/** The place, the job and the execution a call names, each checked as the id it must be; `invalid_argument` otherwise. */
export function checkedExecution(args: { project: string; region: string; job: string; execution: string }): {
  place: Place
  job: string
  execution: string
} {
  return { ...checkedJob(args), execution: resourceName(args.execution, "execution name") }
}

/** The place, the service and the revision a call names, each checked as the id it must be; `invalid_argument` otherwise. */
export function checkedRevision(args: { project: string; region: string; service: string; revision: string }): {
  place: Place
  service: string
  revision: string
} {
  return { ...checkedService(args), revision: resourceName(args.revision, "revision name") }
}

/** The one target of a write to a job: the ids are checked first, then the label's scopes, those of the route `write` the call sends. */
export async function jobTargets(
  args: { account?: string; project: string; region: string; job: string },
  ctx: ToolContext,
  write: Route,
): Promise<string[]> {
  const { place, job } = checkedJob(args)
  const { label } = await runWriteSession(ctx, args.account, write)
  return [runTarget(label, place, "jobs", job)]
}

/** The one target of a write to an execution: the ids are checked first, then the label's scopes. */
export async function executionTargets(
  args: { account?: string; project: string; region: string; job: string; execution: string },
  ctx: ToolContext,
): Promise<string[]> {
  const { place, job, execution } = checkedExecution(args)
  const { label } = await runWriteSession(ctx, args.account, RUN_ROUTES.executionCancel)
  return [runTarget(label, place, "jobs", job, "executions", execution)]
}

/** The one target of a write to a revision: the ids are checked first, then the label's scopes. */
export async function revisionTargets(
  args: { account?: string; project: string; region: string; service: string; revision: string },
  ctx: ToolContext,
): Promise<string[]> {
  const { place, service, revision } = checkedRevision(args)
  const { label } = await runWriteSession(ctx, args.account, RUN_ROUTES.revisionDelete)
  return [runTarget(label, place, "services", service, "revisions", revision)]
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
