import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { RUN_ROUTES } from "./routes"
import { RUN_READ_SCOPE } from "./scopes"

const PLACE = { project: "my-proj", region: "asia-northeast1" }
const BASE = "https://run.googleapis.com/v2/projects/my-proj/locations/asia-northeast1"

/** What a Cloud Run read never does, as the method and path that does it: no write, no IAM change, no builds, no export, no listing or deleting of operations. */
const NEVER_OFFERED = [
  { what: "a write: this layer only reads", matches: (method: string) => method !== "GET" },
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
  test("every route is a GET on the Cloud Run host which only the run.readonly scope allows", () => {
    for (const route of Object.values(RUN_ROUTES)) {
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("run.googleapis.com")
      expect(route.method).toBe("GET")
      expect(route.scopes).toEqual([RUN_READ_SCOPE])
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
  })

  test("a value with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(RUN_ROUTES.service, { ...PLACE, service: "a/b" })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.service, { ...PLACE, service: ".." })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.services, { project: "a/b", region: "asia-northeast1" })).toThrow()
    expect(() => routeUrl(RUN_ROUTES.operation, { ...PLACE, operation: "../x" })).toThrow()
  })
})
