import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANNOTATION_VALUE,
  PARENT,
  SECRET_VALUE,
  SERVICES_URL,
  answer,
  cleanUp,
  condition,
  container,
  fixture,
  freshTokens,
  templateSettings,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const REVISIONS_URL = `${SERVICES_URL}/api/revisions`

/** A revision as `revisions.get` gives it, with two containers and their resolved digests. */
const apiRevision = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/services/api/revisions/api-00007-abc`,
  service: "api",
  generation: "1",
  createTime: "2026-05-30T08:00:00.000Z",
  logUri: "https://console.cloud.google.com/logs/viewer?x=1",
  annotations: { note: ANNOTATION_VALUE },
  maxInstanceRequestConcurrency: 80,
  scaling: { minInstanceCount: 0, maxInstanceCount: 4 },
  conditions: [
    condition("Active", "CONDITION_SUCCEEDED"),
    condition("Ready", "CONDITION_FAILED", { revisionReason: "HEALTH_CHECK_CONTAINER_ERROR", message: "No start." }),
  ],
  containerStatuses: [
    { name: "sidecar", imageDigest: "sha256:side" },
    { name: "app", imageDigest: "sha256:app" },
  ],
  ...templateSettings({
    containers: [container(), container({ name: "sidecar", image: "gcr.io/my-proj/side:2", env: [] })],
  }),
  ...extra,
})

describe("google_run_read revisions", () => {
  test("lists a service's revisions as summaries, each image with its digest by container name", async () => {
    const h = await fixture([answer(REVISIONS_URL, { revisions: [apiRevision()], nextPageToken: "more" })])

    const result = await h.read({ method: "revisions", service: "api", limit: 3 })

    expect(result).toEqual({
      revisions: [
        {
          revision: "api-00007-abc",
          create_time: "2026-05-30T08:00:00.000Z",
          ready: {
            state: "failed",
            reason: "HEALTH_CHECK_CONTAINER_ERROR",
            message: "No start.",
            time: "2026-05-30T08:00:00.000Z",
          },
          images: [
            { image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1", digest: "sha256:app" },
            { image: "gcr.io/my-proj/side:2", digest: "sha256:side" },
          ],
          log_uri: "https://console.cloud.google.com/logs/viewer?x=1",
        },
      ],
      next_page_token: "more",
    })
    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toEqual({ pageSize: "3" })
  })

  test("a digest falls back to the container's position when the names do not match", async () => {
    const unnamed = apiRevision({ containerStatuses: [{ imageDigest: "sha256:first" }] })
    const h = await fixture([answer(REVISIONS_URL, { revisions: [unnamed] })])

    const result = await h.read({ method: "revisions", service: "api" })

    expect(result.revisions?.[0]?.images).toEqual([
      { image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1", digest: "sha256:first" },
      { image: "gcr.io/my-proj/side:2", digest: null },
    ])
  })

  test("a revision with no readiness is unknown, with no images", async () => {
    const h = await fixture([answer(REVISIONS_URL, { revisions: [{ name: `${PARENT}/services/api/revisions/r1` }] })])

    expect((await h.read({ method: "revisions", service: "api" })).revisions).toEqual([
      {
        revision: "r1",
        create_time: null,
        ready: { state: "unknown", reason: null, message: null, time: null },
        images: [],
        log_uri: null,
      },
    ])
  })
})

describe("google_run_read revision", () => {
  const REVISION_URL = `${REVISIONS_URL}/api-00007-abc`

  test("returns the revision with its scaling, conditions and settings, and no environment value", async () => {
    const h = await fixture([answer(REVISION_URL, apiRevision())])

    const result = await h.read({ method: "revision", service: "api", revision: "api-00007-abc" })

    expect(result).toMatchObject({
      revision: "api-00007-abc",
      service: "api",
      generation: "1",
      concurrency: 80,
      min_instances: 0,
      max_instances: 4,
      service_account: "runner@my-proj.iam.gserviceaccount.com",
      timeout: "300s",
      execution_environment: "gen2",
      vpc_access: { connector: `${PARENT}/connectors/vpc`, egress: "ALL_TRAFFIC" },
    })
    expect(result.conditions?.map((entry) => [entry.type, entry.state])).toEqual([
      ["Active", "succeeded"],
      ["Ready", "failed"],
    ])
    expect(result.containers?.[0]?.env).toEqual([
      { name: "PLAIN", kind: "value" },
      { name: "TOKEN", kind: "secret", secret: "api-token", version: "3" },
    ])
    const text = JSON.stringify(result)
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(ANNOTATION_VALUE)
  })
})
