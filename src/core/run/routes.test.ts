import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { RUN_ROUTES } from "./routes"
import { RUN_READ_SCOPE, RUN_SCOPE } from "./scopes"

const PLACE = { project: "my-proj", region: "asia-northeast1" }
const BASE = "https://run.googleapis.com/v2/projects/my-proj/locations/asia-northeast1"

/** The routes that write, by name: the service's and the job's create and patch, running a job, cancelling an execution and deleting a service, a revision or a job, and no other. */
const WRITES = [
  "serviceCreate",
  "servicePatch",
  "jobCreate",
  "jobPatch",
  "jobRun",
  "executionCancel",
  "serviceDelete",
  "revisionDelete",
  "jobDelete",
]

/** The writes as `<method> <path>`, which the one never-offered rule about writes lets through. */
const OFFERED_WRITES = [
  "POST /v2/projects/{project}/locations/{region}/services",
  "PATCH /v2/projects/{project}/locations/{region}/services/{service}",
  "POST /v2/projects/{project}/locations/{region}/jobs",
  "PATCH /v2/projects/{project}/locations/{region}/jobs/{job}",
  "POST /v2/projects/{project}/locations/{region}/jobs/{job}:run",
  "POST /v2/projects/{project}/locations/{region}/jobs/{job}/executions/{execution}:cancel",
  "DELETE /v2/projects/{project}/locations/{region}/services/{service}",
  "DELETE /v2/projects/{project}/locations/{region}/services/{service}/revisions/{revision}",
  "DELETE /v2/projects/{project}/locations/{region}/jobs/{job}",
]

/** What a Cloud Run tool never does, as the method and path that does it: no write but the ones above, so no deleting of an execution, no IAM change, no builds, no export, no listing or deleting of operations. */
const NEVER_OFFERED = [
  {
    what: "a write other than the service and job writes, running a job, cancelling an execution and deleting a service, a revision or a job",
    matches: (method: string, path: string) => method !== "GET" && !OFFERED_WRITES.includes(`${method} ${path}`),
  },
  { what: "setIamPolicy", matches: (_method: string, path: string) => path.includes("setIamPolicy") },
  { what: "testIamPermissions", matches: (_method: string, path: string) => path.includes("testIamPermissions") },
  { what: "worker pools", matches: (_method: string, path: string) => path.includes("/workerPools") },
  { what: "instances", matches: (_method: string, path: string) => path.includes("/instances") },
  { what: "builds", matches: (_method: string, path: string) => path.includes("/builds") },
  { what: "source uploads", matches: (_method: string, path: string) => path.includes("/sourceUploads") },
  { what: "exporting images or metadata", matches: (_method: string, path: string) => /export/i.test(path) },
  {
    what: "operations other than getting one",
    matches: (method: string, path: string) =>
      path.includes("/operations") && (method !== "GET" || !path.endsWith("/operations/{operation}")),
  },
]

describe("RUN_ROUTES", () => {
  test("every read is a GET on the Cloud Run host which only the run.readonly scope allows", () => {
    const reads = Object.entries(RUN_ROUTES).filter(([name]) => !WRITES.includes(name))
    expect(reads.length).toBeGreaterThan(0)
    for (const [, route] of reads) {
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("run.googleapis.com")
      expect(route.method).toBe("GET")
      expect(route.scopes).toEqual([RUN_READ_SCOPE])
    }
  })

  test("the only writes are the service and job writes, a job's run, an execution's cancel and the deletes of a service, a revision and a job, which only the run scope allows", () => {
    const writes = Object.entries(RUN_ROUTES).filter(([, route]) => route.method !== "GET")
    expect(writes.map(([name]) => name).sort()).toEqual([...WRITES].sort())
    expect(RUN_ROUTES.serviceCreate.method).toBe("POST")
    expect(RUN_ROUTES.servicePatch.method).toBe("PATCH")
    expect(RUN_ROUTES.jobCreate.method).toBe("POST")
    expect(RUN_ROUTES.jobPatch.method).toBe("PATCH")
    expect(RUN_ROUTES.jobRun.method).toBe("POST")
    expect(RUN_ROUTES.executionCancel.method).toBe("POST")
    expect(RUN_ROUTES.serviceDelete.method).toBe("DELETE")
    expect(RUN_ROUTES.revisionDelete.method).toBe("DELETE")
    expect(RUN_ROUTES.jobDelete.method).toBe("DELETE")
    for (const [, route] of writes) {
      expect(route.host).toBe("run.googleapis.com")
      expect(route.scopes).toEqual([RUN_SCOPE])
    }
  })

  test.each(NEVER_OFFERED)("never offers $what", ({ matches }) => {
    const offered = Object.entries(RUN_ROUTES).filter(([, route]) => matches(route.method, route.path))
    expect(offered.map(([name]) => name)).toEqual([])
  })

  test("the URLs, the :getIamPolicy suffix kept", () => {
    const service = { ...PLACE, service: "api" }
    const job = { ...PLACE, job: "nightly" }
    const execution = { ...job, execution: "nightly-abc12" }
    expect(routeUrl(RUN_ROUTES.services, PLACE).toString()).toBe(`${BASE}/services`)
    expect(routeUrl(RUN_ROUTES.service, service).toString()).toBe(`${BASE}/services/api`)
    expect(routeUrl(RUN_ROUTES.serviceIam, service).toString()).toBe(`${BASE}/services/api:getIamPolicy`)
    expect(routeUrl(RUN_ROUTES.revisions, service).toString()).toBe(`${BASE}/services/api/revisions`)
    expect(routeUrl(RUN_ROUTES.revision, { ...service, revision: "api-00001-abc" }).toString()).toBe(
      `${BASE}/services/api/revisions/api-00001-abc`,
    )
    expect(routeUrl(RUN_ROUTES.jobs, PLACE).toString()).toBe(`${BASE}/jobs`)
    expect(routeUrl(RUN_ROUTES.job, job).toString()).toBe(`${BASE}/jobs/nightly`)
    expect(routeUrl(RUN_ROUTES.jobIam, job).toString()).toBe(`${BASE}/jobs/nightly:getIamPolicy`)
    expect(routeUrl(RUN_ROUTES.executions, job).toString()).toBe(`${BASE}/jobs/nightly/executions`)
    expect(routeUrl(RUN_ROUTES.execution, execution).toString()).toBe(`${BASE}/jobs/nightly/executions/nightly-abc12`)
    expect(routeUrl(RUN_ROUTES.tasks, execution).toString()).toBe(`${BASE}/jobs/nightly/executions/nightly-abc12/tasks`)
    expect(routeUrl(RUN_ROUTES.operation, { ...PLACE, operation: "op-1_A" }).toString()).toBe(
      `${BASE}/operations/op-1_A`,
    )
    expect(routeUrl(RUN_ROUTES.serviceCreate, PLACE, { serviceId: "api" }).toString()).toBe(
      `${BASE}/services?serviceId=api`,
    )
    expect(routeUrl(RUN_ROUTES.servicePatch, service, { updateMask: "template" }).toString()).toBe(
      `${BASE}/services/api?updateMask=template`,
    )
    expect(routeUrl(RUN_ROUTES.jobCreate, PLACE, { jobId: "nightly" }).toString()).toBe(`${BASE}/jobs?jobId=nightly`)
    expect(routeUrl(RUN_ROUTES.jobPatch, job).toString()).toBe(`${BASE}/jobs/nightly`)
    expect(routeUrl(RUN_ROUTES.jobRun, job).toString()).toBe(`${BASE}/jobs/nightly:run`)
    expect(routeUrl(RUN_ROUTES.executionCancel, execution).toString()).toBe(
      `${BASE}/jobs/nightly/executions/nightly-abc12:cancel`,
    )
    expect(routeUrl(RUN_ROUTES.serviceDelete, service, { etag: '"e1"' }).toString()).toBe(
      `${BASE}/services/api?etag=%22e1%22`,
    )
    expect(routeUrl(RUN_ROUTES.revisionDelete, { ...service, revision: "api-00001-abc" }).toString()).toBe(
      `${BASE}/services/api/revisions/api-00001-abc`,
    )
    expect(routeUrl(RUN_ROUTES.jobDelete, job).toString()).toBe(`${BASE}/jobs/nightly`)
  })

  test("a value with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(RUN_ROUTES.service, { ...PLACE, service: "a/b" })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.service, { ...PLACE, service: ".." })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.services, { project: "a/b", region: "asia-northeast1" })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.operation, { ...PLACE, operation: "../x" })).toThrow()
  })
})
