import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleRunServiceDeploy } from "./deploy"
import {
  OWN_IMAGE,
  PARENT,
  PLACE,
  SECRET_VALUE,
  apiService,
  cleanUp,
  container,
  createHandler,
  freshTokens,
  refusal,
  serviceHandler,
  splitTraffic,
  templateSettings,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call sets, which no prompt may hold. */
const SENT_VALUE = "request-made-up-env-value"

const OLD_IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1"

const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex")

const phrase = (text: string) => ({ text })

async function described(args: Record<string, unknown> = {}, service = apiService()) {
  const h = await writeFixture({ handlers: [serviceHandler({ json: service })] })
  return { h, description: await h.deploy.describe(args) }
}

describe("google_run_service_deploy describe: a service that exists", () => {
  test("shows the same image once with a redeploy note, not an unchanged arrow", async () => {
    const { description } = await described({ image: OLD_IMAGE })

    expect(description.text?.body).toBe(`image: ${OLD_IMAGE} (again; a tag takes the digest it points to now)`)
  })

  test("headlines the image and the service from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to deploy {image} to {service}",
      values: { image: OWN_IMAGE, service: "api" },
    })
  })

  test("shows, in order, what traffic gets, the image now and what the deploy keeps", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Traffic", value: phrase("the new revision gets 100%") },
      { label: "Image now", value: OLD_IMAGE },
      { label: "Runs as", value: "runner@my-proj.iam.gserviceaccount.com" },
      { label: "Secret variables", value: { text: "{count} variable", values: { count: 1 } } },
      { label: "Volumes", value: { text: "{count} volumes", values: { count: 4 } } },
      { label: "VPC access", value: `${PARENT}/connectors/vpc` },
    ])
  })

  test("says the new revision gets none when the traffic is pinned to revisions, or less than all to the latest", async () => {
    const pinned = await described({}, apiService(splitTraffic()))
    expect(pinned.description.facts[0]).toEqual({
      label: "Traffic",
      value: phrase("stays as set; the new revision gets none"),
    })

    const partial = await described(
      {},
      apiService({ traffic: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 60 }] }),
    )
    expect(partial.description.facts[0]!.value).toEqual(phrase("stays as set; the new revision gets none"))

    const unset = await described({}, apiService({ traffic: undefined }))
    expect(unset.description.facts[0]!.value).toEqual(phrase("the new revision gets 100%"))
  })

  test("names the default service account, leaves out what the service has none of and shows an ingress that is not all", async () => {
    const service = apiService({
      ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",
      template: templateSettings({
        serviceAccount: undefined,
        vpcAccess: { egress: "ALL_TRAFFIC" },
        volumes: [],
        containers: [container({ env: [{ name: "PLAIN", value: SECRET_VALUE }] })],
      }),
    })

    const { description } = await described({}, service)

    expect(description.facts.slice(2)).toEqual([
      { label: "Runs as", value: phrase("the default service account") },
      { label: "VPC access", value: phrase("set") },
      { label: "Ingress", value: "internal" },
    ])
  })

  test("lists every change as a line, the old value and the new, and shows no variable's value", async () => {
    const { description } = await described({
      env: { NEW: SENT_VALUE, PLAIN: null },
      command: ["node", "main.js"],
      args: [],
      cpu: "2",
      memory: "1Gi",
      min_instances: 1,
      max_instances: 20,
      timeout_seconds: 60,
      concurrency: 10,
      port: 9000,
    })

    expect(description.text).toEqual({
      label: "Changes",
      body: [
        `image: ${OLD_IMAGE} → ${OWN_IMAGE}`,
        "env NEW: set",
        "env PLAIN: removed",
        'command: ["node"] → ["node","main.js"]',
        'args: ["server.js"] → []',
        "cpu: 1000m → 2",
        "memory: 512Mi → 1Gi",
        "min instances: 0 → 1",
        "max instances: 10 → 20",
        "timeout: 300s → 60s",
        "concurrency: 80 → 10",
        "port: 8080 → 9000",
      ].join("\n"),
    })
    const text = JSON.stringify(description)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
  })

  test("shows - for a setting the service has not set", async () => {
    const service = apiService({
      template: templateSettings({
        timeout: undefined,
        scaling: undefined,
        maxInstanceRequestConcurrency: undefined,
        containers: [container({ command: undefined, args: undefined, resources: undefined, ports: undefined })],
      }),
    })

    const { description } = await described(
      { command: ["a"], cpu: "1", min_instances: 1, timeout_seconds: 5, concurrency: 2, port: 80 },
      service,
    )

    expect(description.text?.body.split("\n").slice(1)).toEqual([
      'command: - → ["a"]',
      "cpu: - → 1",
      "min instances: - → 1",
      "timeout: - → 5s",
      "concurrency: - → 2",
      "port: - → 80",
    ])
  })

  test("is a description the prompt can use: well formed, with its three pins", async () => {
    const h = await writeFixture({ handlers: [serviceHandler()] })

    const args = { ...PLACE, service: "api", image: OWN_IMAGE }
    const whole = await wholeCallDescription(googleRunServiceDeploy, args, h.ctx)

    expect(whole?.facts.length).toBeLessThanOrEqual(8)
    expect(whole?.pins).toEqual({
      etag: '"etag-1"',
      container: "app",
      env: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })
})

describe("google_run_service_deploy describe: a service to create", () => {
  const MISSING = () => serviceHandler(refusal(404, "NOT_FOUND"))

  test("headlines the creation and says what a new service gets, with the change's lines holding no old value", async () => {
    const h = await writeFixture({ handlers: [MISSING(), createHandler()] })

    const description = await h.deploy.describe({ env: { NEW: SENT_VALUE }, cpu: "1" })

    expect(description.headline).toEqual({
      text: "About to create the service {service} from {image}",
      values: { service: "api", image: OWN_IMAGE },
    })
    expect(description.facts).toEqual([
      {
        label: "New service",
        value: phrase("authentication required, Google's default service account and ingress"),
      },
      { label: "Traffic", value: phrase("the new revision gets 100%") },
    ])
    expect(description.text?.body).toBe([`image: ${OWN_IMAGE}`, "env NEW: set", "cpu: 1"].join("\n"))
    expect(JSON.stringify(description)).not.toContain(SENT_VALUE)
  })

  test("pins the etag as absent, the container the call names and the digest of no variables", async () => {
    const h = await writeFixture({ handlers: [MISSING()] })

    expect((await h.deploy.describe({ container: "web" })).pins).toEqual({
      etag: "absent",
      container: "web",
      env: digest([]),
    })
  })
})

describe("google_run_service_deploy pins", () => {
  test("pin the etag, the container and a digest of the variables' names and kinds", async () => {
    const { description } = await described()

    expect(description.pins).toEqual({
      etag: '"etag-1"',
      container: "app",
      env: digest(["PLAIN:value", "TOKEN:secret"]),
    })
  })

  test("change when the etag does, and when a variable has turned into a secret", async () => {
    const before = (await described()).description.pins
    expect((await described()).description.pins).toEqual(before)

    expect((await described({}, apiService({ etag: '"etag-2"' }))).description.pins).not.toEqual(before)

    const turned = apiService({
      template: templateSettings({
        containers: [
          container({
            env: [
              { name: "PLAIN", valueSource: { secretKeyRef: { secret: "s", version: "1" } } },
              { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
            ],
          }),
        ],
      }),
    })
    const after = (await described({}, turned)).description.pins
    expect(after!.etag).toBe(before!.etag)
    expect(after!.env).not.toBe(before!.env)
  })

  test("do not change with the values of the variables", async () => {
    const before = (await described()).description.pins
    const other = apiService({
      template: templateSettings({
        containers: [
          container({
            env: [
              { name: "PLAIN", value: "another-made-up-value" },
              { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
            ],
          }),
        ],
      }),
    })

    expect((await described({}, other)).description.pins).toEqual(before)
  })
})

describe("google_run_service_deploy describe and targets", () => {
  test("describe throws where execute would", async () => {
    const h = await writeFixture({ handlers: [serviceHandler()] })

    expect((await toolError(h.deploy.describe({ env: { TOKEN: "x" } }))).code).toBe("invalid_argument")
  })

  test("the target is the service, under the label, project and region", async () => {
    const h = await writeFixture()

    expect(await h.deploy.targets()).toEqual(["work/projects/my-proj/locations/asia-northeast1/services/api"])
    expect(h.requests).toEqual([])
  })

  test("a call whose ids are not ids has no target", async () => {
    const h = await writeFixture()

    expect(await h.deploy.targets({ service: "a/b" })).toEqual(["*"])
  })
})
