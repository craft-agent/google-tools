import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BASE_URL, JOBS_URL, SERVICES_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SERVICE_IAM_URL = `${SERVICES_URL}/api:getIamPolicy`
const JOB_IAM_URL = `${JOBS_URL}/nightly:getIamPolicy`

const POLICY = {
  version: 3,
  etag: "BwYabc123made-up-etag",
  bindings: [
    {
      role: "roles/run.invoker",
      members: ["user:dev@example.test", "serviceAccount:ci@my-proj.iam.gserviceaccount.com"],
    },
    {
      role: "roles/run.developer",
      members: ["group:devs@example.test"],
      condition: { title: "weekdays", expression: "request.time.getDayOfWeek() < 5" },
    },
  ],
}

describe("google_run_read iam", () => {
  test("returns a service's bindings and says it is not public, never the etag", async () => {
    const h = await fixture([answer(SERVICE_IAM_URL, POLICY)])

    const result = await h.read({ method: "iam", service: "api" })

    expect(result).toEqual({
      bindings: [
        {
          role: "roles/run.invoker",
          members: ["user:dev@example.test", "serviceAccount:ci@my-proj.iam.gserviceaccount.com"],
          condition: null,
        },
        {
          role: "roles/run.developer",
          members: ["group:devs@example.test"],
          condition: { title: "weekdays", expression: "request.time.getDayOfWeek() < 5" },
        },
      ],
      public: false,
    })
    expect(JSON.stringify(result)).not.toContain("etag")
    expect(JSON.stringify(result)).not.toContain(POLICY.etag)
  })

  test("asks for policy version 3, so conditions are kept", async () => {
    const h = await fixture([answer(SERVICE_IAM_URL, POLICY)])

    await h.read({ method: "iam", service: "api" })

    expect(h.calls()[0]!.url.searchParams.get("options.requestedPolicyVersion")).toBe("3")
  })

  test.each(["allUsers", "allAuthenticatedUsers"])("a job's policy with %s as a member is public", async (member) => {
    const h = await fixture([answer(JOB_IAM_URL, { bindings: [{ role: "roles/run.invoker", members: [member] }] })])

    const result = await h.read({ method: "iam", job: "nightly" })

    expect(result).toEqual({
      bindings: [{ role: "roles/run.invoker", members: [member], condition: null }],
      public: true,
    })
    expect(h.calls()[0]!.url.searchParams.get("options.requestedPolicyVersion")).toBe("3")
  })

  test("a policy with no bindings is empty and not public", async () => {
    const h = await fixture([answer(SERVICE_IAM_URL, { etag: "x" })])

    expect(await h.read({ method: "iam", service: "api" })).toEqual({ bindings: [], public: false })
  })
})

describe("google_run_read operation", () => {
  const OPERATION_URL = `${BASE_URL}/operations/op-123`

  test("a finished operation is done, with the resource it changed", async () => {
    const h = await fixture([
      answer(OPERATION_URL, {
        name: "projects/my-proj/locations/asia-northeast1/operations/op-123",
        done: true,
        metadata: {
          "@type": "type.googleapis.com/google.cloud.run.v2.Service",
          name: "projects/my-proj/locations/asia-northeast1/services/api",
          annotations: { note: "metadata-body-value" },
        },
        response: { "@type": "type.googleapis.com/google.cloud.run.v2.Service", uri: "https://response-body.run.app" },
      }),
    ])

    const result = await h.read({ method: "operation", operation: "op-123" })

    expect(result).toEqual({
      operation: "op-123",
      done: true,
      error: null,
      resource: "api",
      resource_kind: "service",
    })
    expect(JSON.stringify(result)).not.toContain("metadata-body-value")
    expect(JSON.stringify(result)).not.toContain("response-body")
  })

  test("a running operation is not done and has no error", async () => {
    const h = await fixture([
      answer(OPERATION_URL, {
        name: "projects/my-proj/locations/asia-northeast1/operations/op-123",
        metadata: { name: "projects/my-proj/locations/asia-northeast1/jobs/nightly/executions/nightly-abc12" },
      }),
    ])

    expect(await h.read({ method: "operation", operation: "op-123" })).toEqual({
      operation: "op-123",
      done: false,
      error: null,
      resource: "nightly-abc12",
      resource_kind: "execution",
    })
  })

  test("a failed operation gives Google's error code and message", async () => {
    const h = await fixture([
      answer(OPERATION_URL, {
        name: "op-123",
        done: true,
        error: { code: 9, message: "Revision failed." },
        metadata: { name: "projects/my-proj/locations/asia-northeast1/services/api/revisions/api-00001-abc" },
      }),
    ])

    expect(await h.read({ method: "operation", operation: "op-123" })).toEqual({
      operation: "op-123",
      done: true,
      error: { code: 9, message: "Revision failed." },
      resource: "api-00001-abc",
      resource_kind: "revision",
    })
  })

  test("an operation on a job names a job, and one with no metadata name names no resource", async () => {
    const h = await fixture([
      answer(OPERATION_URL, {
        name: "op-123",
        metadata: { name: "projects/my-proj/locations/asia-northeast1/jobs/nightly" },
      }),
      answer(`${BASE_URL}/operations/op-124`, { name: "op-124", metadata: { name: 5 } }),
    ])

    expect(await h.read({ method: "operation", operation: "op-123" })).toMatchObject({
      resource: "nightly",
      resource_kind: "job",
    })
    expect(await h.read({ method: "operation", operation: "op-124" })).toMatchObject({
      resource: null,
      resource_kind: null,
    })
  })
})
