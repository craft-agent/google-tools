import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  OWN_IMAGE,
  PARENT,
  SECRET_VALUE,
  SERVICE_URL,
  apiService,
  callOf,
  cleanUp,
  createHandler,
  finished,
  freshTokens,
  refusal,
  serviceHandler,
  SERVICES_URL,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const missing = () => serviceHandler(refusal(404, "NOT_FOUND", "Service not found."))

const created = () =>
  createHandler({
    json: finished(apiService({ latestCreatedRevision: `${PARENT}/services/api/revisions/api-00001-new` })),
  })

describe("google_run_service_deploy: a service that does not exist", () => {
  test("is created with a POST to the region's services with its id, holding only the image when that is all", async () => {
    const h = await writeFixture({ handlers: [missing(), created()] })

    const result = await h.deploy.run()

    expect(h.calls().map(callOf)).toEqual([`GET ${SERVICE_URL}`, `POST ${SERVICES_URL}`])
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ serviceId: "api" })
    expect(post!.json).toEqual({ template: { containers: [{ image: OWN_IMAGE }] } })
    expect(result).toMatchObject({
      created: true,
      before: null,
      revision: "api-00001-new",
      service: { service: "api" },
      operation: { operation: "op-1", done: true },
    })
  })

  test("sends only what the call gives, and nothing about ingress, access or the service account", async () => {
    const h = await writeFixture({ handlers: [missing(), created()] })

    await h.deploy.run({
      container: "web",
      env: { MODE: "prod", EMPTY: "" },
      command: ["node"],
      args: ["server.js", "--quiet"],
      cpu: "500m",
      memory: "256Mi",
      min_instances: 1,
      max_instances: 4,
      timeout_seconds: 120,
      concurrency: 20,
      port: 3000,
    })

    expect(h.writes()[0]!.json).toEqual({
      template: {
        containers: [
          {
            name: "web",
            image: OWN_IMAGE,
            env: [
              { name: "MODE", value: "prod" },
              { name: "EMPTY", value: "" },
            ],
            command: ["node"],
            args: ["server.js", "--quiet"],
            resources: { limits: { cpu: "500m", memory: "256Mi" } },
            ports: [{ containerPort: 3000 }],
          },
        ],
        scaling: { minInstanceCount: 1, maxInstanceCount: 4 },
        timeout: "120s",
        maxInstanceRequestConcurrency: 20,
      },
    })
  })

  test("takes a minimum of zero and keeps only the scaling key it was given", async () => {
    const h = await writeFixture({ handlers: [missing(), created()] })

    await h.deploy.run({ min_instances: 0 })

    expect(h.writes()[0]!.json).toEqual({
      template: { containers: [{ image: OWN_IMAGE }], scaling: { minInstanceCount: 0 } },
    })
  })

  test("a variable to remove is refused: there is nothing to remove, and nothing is sent", async () => {
    const h = await writeFixture({ handlers: [missing(), created()] })

    const error = await toolError(h.deploy.run({ env: { KEEP: "x", GONE: null } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`GONE`")
    expect(error.message).toContain("nothing was changed")
    expect(h.writes()).toEqual([])
  })

  test("a conflict because someone made the service meanwhile is stale", async () => {
    const h = await writeFixture({
      handlers: [missing(), createHandler(refusal(409, "ALREADY_EXISTS", "Service already exists."))],
    })

    const error = await toolError(h.deploy.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe("The service changed since it was read; nothing was changed. Read it again and retry.")
  })

  test("returns no environment value from the call, and the result matches the schema", async () => {
    const h = await writeFixture({ handlers: [missing(), created()] })

    const result = await h.deploy.run({ env: { MODE: SECRET_VALUE } })

    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE)
  })
})
