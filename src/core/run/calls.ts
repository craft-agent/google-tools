import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { operationReply, operationView, policyReply, policyView, type OperationView } from "./access-view"
import {
  executionReply,
  executionSummary,
  executionView,
  taskReply,
  taskView,
  type ExecutionSummary,
  type ExecutionView,
  type TaskView,
} from "./execution-view"
import { jobReply, jobSummary, jobView, type JobSummary, type JobView } from "./job-view"
import { revisionReply, revisionSummary, revisionView, type RevisionSummary, type RevisionView } from "./revision-view"
import { RUN_ROUTES } from "./routes"
import { DEFAULT_LIMIT, type RunReadArgs } from "./schemas"
import { serviceReply, serviceSummary, serviceView, type ServiceSummary, type ServiceView } from "./service-view"

/** The project and region every call names, as validated ids. */
export type Place = { project: string; region: string }

type Page = Pick<RunReadArgs, "limit" | "page_token">

/** One page of a list under its key, with the token of the next. */
type Listed<Key extends string, Item> = { [K in Key]: Item[] } & { next_page_token: string | null }

/** The IAM policy version asked for, which keeps the conditions of a binding. */
const POLICY_VERSION = 3

const nextPage = { nextPageToken: z.string().optional() }

const servicesList = z.object({ services: z.array(serviceReply).optional(), ...nextPage })
const revisionsList = z.object({ revisions: z.array(revisionReply).optional(), ...nextPage })
const jobsList = z.object({ jobs: z.array(jobReply).optional(), ...nextPage })
const executionsList = z.object({ executions: z.array(executionReply).optional(), ...nextPage })
const tasksList = z.object({ tasks: z.array(taskReply).optional(), ...nextPage })

const pageQuery = (page: Page) => ({ pageSize: page.limit ?? DEFAULT_LIMIT, pageToken: page.page_token })

/** The services of the region, one page. */
export async function listServices(
  client: GoogleClient,
  place: Place,
  page: Page,
): Promise<Listed<"services", ServiceSummary>> {
  const listed = parseReply(
    servicesList,
    await client.request(RUN_ROUTES.services, { params: place, query: pageQuery(page) }),
    "the service list",
  )
  return { services: (listed.services ?? []).map(serviceSummary), next_page_token: listed.nextPageToken ?? null }
}

/** One service in full. */
export async function readService(client: GoogleClient, place: Place, service: string): Promise<ServiceView> {
  const reply = await client.request(RUN_ROUTES.service, { params: { ...place, service } })
  return serviceView(parseReply(serviceReply, reply, "a service"))
}

/** The revisions of a service, one page. */
export async function listRevisions(
  client: GoogleClient,
  place: Place,
  service: string,
  page: Page,
): Promise<Listed<"revisions", RevisionSummary>> {
  const listed = parseReply(
    revisionsList,
    await client.request(RUN_ROUTES.revisions, { params: { ...place, service }, query: pageQuery(page) }),
    "the revision list",
  )
  return { revisions: (listed.revisions ?? []).map(revisionSummary), next_page_token: listed.nextPageToken ?? null }
}

/** One revision in full. */
export async function readRevision(
  client: GoogleClient,
  place: Place,
  service: string,
  revision: string,
): Promise<RevisionView> {
  const reply = await client.request(RUN_ROUTES.revision, { params: { ...place, service, revision } })
  return revisionView(parseReply(revisionReply, reply, "a revision"))
}

/** The jobs of the region, one page. */
export async function listJobs(client: GoogleClient, place: Place, page: Page): Promise<Listed<"jobs", JobSummary>> {
  const listed = parseReply(
    jobsList,
    await client.request(RUN_ROUTES.jobs, { params: place, query: pageQuery(page) }),
    "the job list",
  )
  return { jobs: (listed.jobs ?? []).map(jobSummary), next_page_token: listed.nextPageToken ?? null }
}

/** One job in full. */
export async function readJob(client: GoogleClient, place: Place, job: string): Promise<JobView> {
  const reply = await client.request(RUN_ROUTES.job, { params: { ...place, job } })
  return jobView(parseReply(jobReply, reply, "a job"))
}

/** The executions of a job, one page. */
export async function listExecutions(
  client: GoogleClient,
  place: Place,
  job: string,
  page: Page,
): Promise<Listed<"executions", ExecutionSummary>> {
  const listed = parseReply(
    executionsList,
    await client.request(RUN_ROUTES.executions, { params: { ...place, job }, query: pageQuery(page) }),
    "the execution list",
  )
  return { executions: (listed.executions ?? []).map(executionSummary), next_page_token: listed.nextPageToken ?? null }
}

/** One execution in full. */
export async function readExecution(
  client: GoogleClient,
  place: Place,
  job: string,
  execution: string,
): Promise<ExecutionView> {
  const reply = await client.request(RUN_ROUTES.execution, { params: { ...place, job, execution } })
  return executionView(parseReply(executionReply, reply, "an execution"))
}

/** The tasks of an execution, one page. */
export async function listTasks(
  client: GoogleClient,
  place: Place,
  job: string,
  execution: string,
  page: Page,
): Promise<Listed<"tasks", TaskView>> {
  const listed = parseReply(
    tasksList,
    await client.request(RUN_ROUTES.tasks, { params: { ...place, job, execution }, query: pageQuery(page) }),
    "the task list",
  )
  return { tasks: (listed.tasks ?? []).map(taskView), next_page_token: listed.nextPageToken ?? null }
}

/** The IAM policy of a service or, when `target.job` is given, of a job: its bindings and whether it is public. */
export async function readPolicy(client: GoogleClient, place: Place, target: { service: string } | { job: string }) {
  const query = { "options.requestedPolicyVersion": POLICY_VERSION }
  const reply =
    "service" in target
      ? await client.request(RUN_ROUTES.serviceIam, { params: { ...place, service: target.service }, query })
      : await client.request(RUN_ROUTES.jobIam, { params: { ...place, job: target.job }, query })
  return policyView(parseReply(policyReply, reply, "an IAM policy"))
}

/** One operation's state, error and the resource it changes. */
export async function readOperation(client: GoogleClient, place: Place, operation: string): Promise<OperationView> {
  const reply = await client.request(RUN_ROUTES.operation, { params: { ...place, operation } })
  return operationView(parseReply(operationReply, reply, "an operation"))
}
