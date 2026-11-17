import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { ServiceView } from "./service-view"
import {
  OWN_IMAGE,
  SECRET_VALUE,
  apiService,
  cleanUp,
  container,
  finished,
  freshTokens,
  patchHandler,
  serviceHandler,
  templateSettings,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call sets and an echoing reply repeats, which no result may hold. */
const SENT_VALUE = "request-made-up-env-value"

type Template = { containers: Record<string, any>[]; [key: string]: any }

/** The template Google gave, without its `revision`, with `change` applied: what a deploy must send. */
function expectedTemplate(change: (template: Template) => void): Template {
  const template = structuredClone(apiService().template) as Template
  delete template.revision
  change(template)
  return template
}

/** A PATCH that answers with the operation done and the service as the request made it. */
const echoingPatch = () =>
  patchHandler((request) => ({
    json: finished(apiService({ template: (request.json as { template: unknown }).template })),
  }))

async function deployed(args: Record<string, unknown> = {}, service = apiService()) {
  const h = await writeFixture({ handlers: [serviceHandler({ json: service }), echoingPatch()] })
  const result = await h.deploy.run(args)
  const [patch] = h.writes()
  return { h, result, patch: patch!, body: patch!.json as { template: Template; etag?: string } }
}

describe("google_run_service_deploy: a service that exists", () => {
  test("sends one PATCH that updates the template, forces a new revision and carries the etag", async () => {
    const { h, patch, body } = await deployed()

    expect(h.writes()).toHaveLength(1)
    expect(Object.fromEntries(patch.url.searchParams)).toEqual({ updateMask: "template", forceNewRevision: "true" })
    expect(body.etag).toBe('"etag-1"')
  })

  test("sends back the template as Google gave it, with only the image changed and the revision dropped", async () => {
    const { body } = await deployed()

    expect(body.template).toEqual(
      expectedTemplate((template) => {
        template.containers[0]!.image = OWN_IMAGE
      }),
    )
    expect(body.template.revision).toBeUndefined()
    expect(body.template.futureField).toEqual({ nested: [1, 2, 3] })
    expect(body.template.serviceAccount).toBe("runner@my-proj.iam.gserviceaccount.com")
    expect(body.template.vpcAccess).toEqual(apiService().template.vpcAccess)
    expect(body.template.volumes).toHaveLength(4)
    expect(body.template.containers[0]!.env[1]).toEqual({
      name: "TOKEN",
      valueSource: { secretKeyRef: { secret: "api-token", version: "3" } },
    })
  })

  test("sets a variable that is new, replaces one that is there in place and removes another, keeping the secret", async () => {
    const { body } = await deployed({ env: { NEW: SENT_VALUE, PLAIN: "replaced" } })
    expect(body.template.containers[0]!.env).toEqual([
      { name: "PLAIN", value: "replaced" },
      { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
      { name: "NEW", value: SENT_VALUE },
    ])

    const removed = await deployed({ env: { PLAIN: null } })
    expect(removed.body.template.containers[0]!.env).toEqual([
      { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
    ])
  })

  test("changes the settings it is given and keeps the ones it is not, down to a limit's neighbours", async () => {
    const { body } = await deployed({
      command: ["node", "main.js"],
      args: [],
      cpu: "2",
      min_instances: 2,
      timeout_seconds: 60,
      concurrency: 10,
      port: 9000,
    })

    expect(body.template).toEqual(
      expectedTemplate((template) => {
        const [only] = template.containers
        Object.assign(only!, {
          image: OWN_IMAGE,
          command: ["node", "main.js"],
          args: [],
          ports: [{ name: "http1", containerPort: 9000 }],
        })
        only!.resources.limits.cpu = "2"
        template.scaling.minInstanceCount = 2
        template.timeout = "60s"
        template.maxInstanceRequestConcurrency = 10
      }),
    )
  })

  test("sets memory without touching the CPU limit, and a port with no name keeps none", async () => {
    const service = apiService({
      template: templateSettings({ containers: [container({ ports: [{ containerPort: 8080 }] })] }),
    })
    const { body } = await deployed({ memory: "1Gi", max_instances: 0, port: 80 }, service)

    const [only] = body.template.containers
    expect(only!.resources).toEqual({ limits: { cpu: "1000m", memory: "1Gi" }, cpuIdle: true, startupCpuBoost: false })
    expect(only!.ports).toEqual([{ containerPort: 80 }])
    expect(body.template.scaling).toEqual({ maxInstanceCount: 0 })
  })

  test("changes only the container it names among several", async () => {
    const service = apiService({
      template: templateSettings({
        containers: [container(), container({ name: "sidecar", image: "gcr.io/my-proj/side:1" })],
      }),
    })
    const { body } = await deployed({ container: "sidecar", cpu: "250m" }, service)

    const [app, sidecar] = body.template.containers
    expect(app).toEqual(container())
    expect(sidecar).toMatchObject({ name: "sidecar", image: OWN_IMAGE })
    expect(sidecar!.resources.limits.cpu).toBe("250m")
  })

  test("returns what it was before and the service as it is now, with no environment value from the reply or the call", async () => {
    const { result } = await deployed({ env: { NEW: SENT_VALUE } })

    expect(result).toMatchObject({
      created: false,
      revision: "api-00007-abc",
      before: {
        image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1",
        template: {
          revision: "api-00008-def",
          service_account: "runner@my-proj.iam.gserviceaccount.com",
          containers: [
            {
              env: [
                { name: "PLAIN", kind: "value" },
                { name: "TOKEN", kind: "secret", secret: "api-token", version: "3" },
              ],
            },
          ],
        },
      },
      service: { service: "api" },
      operation: { operation: "op-1", done: true },
    })
    const { service } = result as { service: ServiceView }
    expect(service.template.containers[0]!.env.map((env) => env.name)).toEqual(["PLAIN", "TOKEN", "NEW"])
    const text = JSON.stringify(result)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
  })

  test("a service with no etag is updated without one", async () => {
    const { body } = await deployed({}, apiService({ etag: undefined }))

    expect(body).not.toHaveProperty("etag")
  })
})
