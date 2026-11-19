import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANNOTATION_VALUE,
  PARENT,
  SECRET_VALUE,
  SERVICES_URL,
  answer,
  cleanUp,
  condition,
  fixture,
  freshTokens,
  templateSettings,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SERVICE_URL = `${SERVICES_URL}/api`

/** A service as `services.get` gives it, annotations included. */
const apiService = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/services/api`,
  description: "The API.",
  uri: "https://api-abc-an.a.run.app",
  urls: ["https://api-abc-an.a.run.app", "https://api-123.asia-northeast1.run.app"],
  labels: { team: "core" },
  annotations: { note: ANNOTATION_VALUE },
  generation: "7",
  createTime: "2026-05-01T09:30:00.000Z",
  updateTime: "2026-05-30T08:00:00.000Z",
  creator: "dev@example.test",
  lastModifier: "ci@example.test",
  launchStage: "GA",
  ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
  invokerIamDisabled: true,
  defaultUriDisabled: false,
  iapEnabled: false,
  customAudiences: ["aud-1"],
  reconciling: false,
  terminalCondition: condition("Ready", "CONDITION_SUCCEEDED"),
  conditions: [
    condition("Ready", "CONDITION_SUCCEEDED"),
    condition("RoutesReady", "CONDITION_FAILED", { reason: "ROUTE_MISSING", message: "No route." }),
  ],
  latestReadyRevision: `${PARENT}/services/api/revisions/api-00007-abc`,
  latestCreatedRevision: `${PARENT}/services/api/revisions/api-00008-def`,
  traffic: [
    { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 90 },
    { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "api-00006-xyz", percent: 10, tag: "canary" },
  ],
  trafficStatuses: [
    { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", revision: "api-00007-abc", percent: 90 },
    {
      type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
      revision: "api-00006-xyz",
      percent: 10,
      uri: "https://canary---api.run.app",
    },
  ],
  scaling: { minInstanceCount: 1, maxInstanceCount: 5, scalingMode: "AUTOMATIC" },
  template: templateSettings({
    revision: "api-00008-def",
    maxInstanceRequestConcurrency: 80,
    sessionAffinity: true,
    scaling: { minInstanceCount: 0, maxInstanceCount: 10 },
    annotations: { note: ANNOTATION_VALUE },
  }),
  ...extra,
})

describe("google_run_read services", () => {
  test("lists the services as summaries, with the paging field", async () => {
    const h = await fixture([
      answer(SERVICES_URL, {
        services: [
          apiService(),
          {
            name: `${PARENT}/services/new`,
            terminalCondition: condition("Ready", "CONDITION_RECONCILING", { reason: "REVISION_REASON_UNSPECIFIED" }),
          },
        ],
        nextPageToken: "next-1",
      }),
    ])

    const result = await h.read({ method: "services" })

    expect(result).toEqual({
      services: [
        {
          service: "api",
          uri: "https://api-abc-an.a.run.app",
          ready: { state: "succeeded", reason: null, message: null, time: "2026-05-30T08:00:00.000Z" },
          latest_ready_revision: "api-00007-abc",
          latest_created_revision: "api-00008-def",
          update_time: "2026-05-30T08:00:00.000Z",
          last_modifier: "ci@example.test",
        },
        {
          service: "new",
          uri: null,
          ready: { state: "reconciling", reason: null, message: null, time: "2026-05-30T08:00:00.000Z" },
          latest_ready_revision: null,
          latest_created_revision: null,
          update_time: null,
          last_modifier: null,
        },
      ],
      next_page_token: "next-1",
    })
  })

  test("a list with nothing in it is no services and no next page", async () => {
    const h = await fixture([answer(SERVICES_URL, {})])

    expect(await h.read({ method: "services" })).toEqual({ services: [], next_page_token: null })
  })

  test("asks for 50 at a time by default, and passes the limit and the page token through", async () => {
    const h = await fixture([answer(SERVICES_URL, {})])

    await h.read({ method: "services" })
    await h.read({ method: "services", limit: 7, page_token: "tok" })

    const [first, second] = h.calls().map((call) => Object.fromEntries(call.url.searchParams))
    expect(first).toEqual({ pageSize: "50" })
    expect(second).toEqual({ pageSize: "7", pageToken: "tok" })
  })
})

describe("google_run_read service", () => {
  test("returns the service's traffic, scaling, template and conditions", async () => {
    const h = await fixture([answer(SERVICE_URL, apiService())])

    const result = await h.read({ method: "service", service: "api" })

    expect(result).toMatchObject({
      service: "api",
      description: "The API.",
      labels: { team: "core" },
      urls: ["https://api-abc-an.a.run.app", "https://api-123.asia-northeast1.run.app"],
      ingress: "internal_load_balancer",
      invoker_iam_disabled: true,
      default_uri_disabled: false,
      iap_enabled: false,
      custom_audiences: ["aud-1"],
      generation: "7",
      reconciling: false,
      create_time: "2026-05-01T09:30:00.000Z",
      creator: "dev@example.test",
      launch_stage: "GA",
      traffic: [
        { type: "latest", revision: null, percent: 90, tag: null },
        { type: "revision", revision: "api-00006-xyz", percent: 10, tag: "canary" },
      ],
      traffic_statuses: [
        { type: "latest", revision: "api-00007-abc", percent: 90, tag: null, uri: null },
        { type: "revision", revision: "api-00006-xyz", percent: 10, tag: null, uri: "https://canary---api.run.app" },
      ],
      scaling: { min_instances: 1, max_instances: 5, mode: "automatic", manual_instances: null },
    })
    expect(result.conditions).toEqual([
      { type: "Ready", state: "succeeded", reason: null, message: null, time: "2026-05-30T08:00:00.000Z" },
      {
        type: "RoutesReady",
        state: "failed",
        reason: "ROUTE_MISSING",
        message: "No route.",
        time: "2026-05-30T08:00:00.000Z",
      },
    ])
    expect(result.template).toMatchObject({
      revision: "api-00008-def",
      concurrency: 80,
      session_affinity: true,
      min_instances: 0,
      max_instances: 10,
      service_account: "runner@my-proj.iam.gserviceaccount.com",
      timeout: "300s",
      execution_environment: "gen2",
      encryption_key: null,
      vpc_access: { connector: `${PARENT}/connectors/vpc`, egress: "ALL_TRAFFIC" },
      volumes: [
        { name: "certs", kind: "secret" },
        { name: "db", kind: "cloud_sql" },
        { name: "blob", kind: "gcs" },
        { name: "scratch", kind: "empty_dir" },
      ],
    })
  })

  test("a container's environment is its names and kinds, never a plain value", async () => {
    const h = await fixture([answer(SERVICE_URL, apiService())])

    const result = await h.read({ method: "service", service: "api" })

    expect(result.template?.containers).toEqual([
      {
        name: "app",
        image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1",
        command: ["node"],
        args: ["server.js"],
        working_dir: null,
        ports: [{ name: "http1", container_port: 8080 }],
        resources: { cpu: "1000m", memory: "512Mi", cpu_idle: true, startup_cpu_boost: false },
        env: [
          { name: "PLAIN", kind: "value" },
          { name: "TOKEN", kind: "secret", secret: "api-token", version: "3" },
        ],
        volume_mounts: [{ name: "certs", mount_path: "/certs" }],
      },
    ])
    const text = JSON.stringify(result)
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(ANNOTATION_VALUE)
    expect(text).not.toContain("annotations")
    expect(text).not.toContain("tls-cert")
    expect(text).not.toContain("made-up-bucket")
  })

  test("a service with little set is shown with defaults, and an unknown ingress is null", async () => {
    const h = await fixture([answer(SERVICE_URL, { name: `${PARENT}/services/api`, ingress: "INGRESS_TRAFFIC_X" })])

    expect(await h.read({ method: "service", service: "api" })).toMatchObject({
      service: "api",
      ingress: null,
      labels: {},
      urls: [],
      traffic: [],
      invoker_iam_disabled: false,
      scaling: { min_instances: null, max_instances: null, mode: null, manual_instances: null },
      template: { revision: null, concurrency: null, session_affinity: false, containers: [], volumes: [] },
      ready: { state: "unknown", reason: null, message: null, time: null },
    })
  })

  test("a reply that is not a service is upstream_error", async () => {
    const h = await fixture([answer(SERVICE_URL, { name: 5 })])

    await expect(h.read({ method: "service", service: "api" })).rejects.toMatchObject({
      code: "upstream_error",
      message: "Google's reply to a service was not in the expected shape.",
    })
  })
})
