import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { RUN_CREDENTIAL } from "./read.testing"
import {
  apiService,
  cleanUp,
  container,
  freshTokens,
  patchHandler,
  refusal,
  serviceHandler,
  templateSettings,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The service changed since it was read; nothing was changed. Read it again and retry."

const existing = (service = apiService()) => [serviceHandler({ json: service }), patchHandler()]

describe("google_run_service_deploy: an image outside the project's registry", () => {
  test.each([
    ["Docker Hub", "docker.io/library/nginx:latest"],
    ["ghcr.io", "ghcr.io/my-proj/api:1"],
    ["another project's registry", "us-docker.pkg.dev/other-proj/apps/api:1"],
    ["a bare name", "nginx"],
    ["a port", "gcr.io:443/my-proj/api"],
  ])("refuses %s as forbidden before any request is made", async (_name, image) => {
    const h = await writeFixture({ handlers: existing() })

    const error = await toolError(h.deploy.run({ image }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(JSON.stringify(image))
    expect(h.requests).toEqual([])
  })
})

describe("google_run_service_deploy: refusals before anything is sent", () => {
  test("a variable that references a secret is refused to set, and to remove", async () => {
    const h = await writeFixture({ handlers: existing() })

    for (const value of ["new", null]) {
      const error = await toolError(h.deploy.run({ env: { TOKEN: value } }))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(
        "`TOKEN` references a secret, which these tools never set or remove; nothing was changed.",
      )
    }
    expect(h.writes()).toEqual([])
  })

  test("removing a variable the container does not have is refused", async () => {
    const h = await writeFixture({ handlers: existing() })

    const error = await toolError(h.deploy.run({ env: { MISSING: null } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`MISSING`")
    expect(h.writes()).toEqual([])
  })

  test("a service with several containers needs the one to change named", async () => {
    const service = apiService({
      template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }),
    })
    const h = await writeFixture({ handlers: existing(service) })

    const error = await toolError(h.deploy.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"app", "sidecar"')
    expect(h.writes()).toEqual([])
  })

  test("a container name that is none of the service's containers is refused, also for the only one", async () => {
    const service = apiService({
      template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }),
    })
    const several = await writeFixture({ handlers: existing(service) })
    expect((await toolError(several.deploy.run({ container: "other" }))).code).toBe("invalid_argument")
    expect(several.writes()).toEqual([])

    const only = await writeFixture({ handlers: existing() })
    const error = await toolError(only.deploy.run({ container: "other" }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"other"')
    expect(only.writes()).toEqual([])
  })

  test("a minimum above the maximum is refused before any request", async () => {
    const h = await writeFixture({ handlers: existing() })

    const error = await toolError(h.deploy.run({ min_instances: 5, max_instances: 2 }))

    expect(error.code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("an id that is not a short name is refused before any request", async () => {
    const h = await writeFixture({ handlers: existing() })

    expect((await toolError(h.deploy.run({ service: "projects/p/services/api" }))).code).toBe("invalid_argument")
    expect((await toolError(h.deploy.run({ project: "X", image: "gcr.io/X/api" }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a variable that is not a name", { env: { "1BAD": "x" } }],
    ["a value over 32768 characters", { env: { OK: "x".repeat(32_769) } }],
    ["more than 50 variables", { env: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`V${i}`, "x"])) }],
    ["a cpu that is not a quantity", { cpu: "one" }],
    ["a memory in the wrong unit", { memory: "512MB" }],
    ["a timeout over an hour", { timeout_seconds: 3601 }],
    ["a port of zero", { port: 0 }],
    ["a command of 101 items", { command: Array.from({ length: 101 }, () => "x") }],
    ["an argument it does not take", { ingress: "all" }],
  ])("refuses %s as invalid_argument", async (_name, args) => {
    const h = await writeFixture({ handlers: existing() })

    expect((await toolError(h.deploy.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: existing(), credential: RUN_CREDENTIAL })

    expect((await toolError(h.deploy.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test("a template that holds a value the client masked is not sent back with the mask", async () => {
    const masked = `AIza${"a".repeat(35)}`
    const service = apiService({
      template: templateSettings({ containers: [container({ env: [{ name: "KEY", value: masked }] })] }),
    })
    const h = await writeFixture({ handlers: existing(service) })

    const error = await toolError(h.deploy.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("nothing was changed")
    expect(error.message).not.toContain(masked)
    expect(h.writes()).toEqual([])
  })
})

describe("google_run_service_deploy: what Google refuses", () => {
  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The service was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing changed", async (_name, reply) => {
    const h = await writeFixture({ handlers: [serviceHandler(), patchHandler(reply)] })

    const error = await toolError(h.deploy.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [serviceHandler(), patchHandler(refusal(403, "PERMISSION_DENIED", "No permission."))],
    })
    expect((await toolError(denied.deploy.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [serviceHandler(), patchHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.deploy.run())).code).toBe("upstream_error")
  })

  test("a failure to read the service other than a missing one is not taken for a new service", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(refusal(403, "PERMISSION_DENIED"))] })

    expect((await toolError(h.deploy.run())).code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })
})
