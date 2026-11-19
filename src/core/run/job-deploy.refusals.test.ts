import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { jobHandler, jobPatchHandler, nightlyJob } from "./jobs.testing"
import { RUN_CREDENTIAL } from "./read.testing"
import { cleanUp, container, freshTokens, refusal, templateSettings, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The job changed since it was read; nothing was changed. Read it again and retry."

const existing = (job = nightlyJob()) => [jobHandler({ json: job }), jobPatchHandler()]

const severalContainers = () =>
  nightlyJob({
    template: {
      taskCount: 4,
      template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }),
    },
  })

describe("google_run_job_deploy: an image outside the project's registry", () => {
  test.each([
    ["Docker Hub", "docker.io/library/nginx:latest"],
    ["ghcr.io", "ghcr.io/my-proj/api:1"],
    ["another project's registry", "us-docker.pkg.dev/other-proj/apps/api:1"],
  ])("refuses %s as forbidden before any request is made", async (_name, image) => {
    const h = await writeFixture({ handlers: existing() })

    const error = await toolError(h.jobDeploy.run({ image }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(JSON.stringify(image))
    expect(h.requests).toEqual([])
  })
})

describe("google_run_job_deploy: refusals before anything is sent", () => {
  test("a variable that references a secret is refused to set, and to remove", async () => {
    const h = await writeFixture({ handlers: existing() })

    for (const value of ["new", null]) {
      const error = await toolError(h.jobDeploy.run({ env: { TOKEN: value } }))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(
        "`TOKEN` references a secret, which these tools never set or remove; nothing was changed.",
      )
    }
    expect(h.writes()).toEqual([])
  })

  test("a parallelism above the task count is refused before any request", async () => {
    const h = await writeFixture({ handlers: existing() })

    const error = await toolError(h.jobDeploy.run({ task_count: 2, parallelism: 3 }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`parallelism` (3)")
    expect(h.requests).toEqual([])
  })

  test("a job with several containers needs the one to change named, and a name that is none of them is refused", async () => {
    const h = await writeFixture({ handlers: existing(severalContainers()) })

    const unnamed = await toolError(h.jobDeploy.run())
    expect(unnamed.code).toBe("invalid_argument")
    expect(unnamed.message).toContain('"app", "sidecar"')

    const unknown = await toolError(h.jobDeploy.run({ container: "other" }))
    expect(unknown.code).toBe("invalid_argument")
    expect(unknown.message).toContain('"other"')
    expect(h.writes()).toEqual([])
  })

  test("an id that is not a short name is refused before any request", async () => {
    const h = await writeFixture({ handlers: existing() })

    expect((await toolError(h.jobDeploy.run({ job: "projects/p/jobs/nightly" }))).code).toBe("invalid_argument")
    expect((await toolError(h.jobDeploy.run({ job: "Nightly" }))).code).toBe("invalid_argument")
    expect((await toolError(h.jobDeploy.run({ project: "X", image: "gcr.io/X/api" }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a timeout over seven days", { timeout_seconds: 604_801 }],
    ["a task count of zero", { task_count: 0 }],
    ["more than 10000 tasks", { task_count: 10_001 }],
    ["a parallelism of zero", { parallelism: 0 }],
    ["more than 10 retries", { max_retries: 11 }],
    ["negative retries", { max_retries: -1 }],
    ["a port, which a job does not take", { port: 8080 }],
    ["an instance count, which a job does not take", { min_instances: 1 }],
    ["a variable that is not a name", { env: { "1BAD": "x" } }],
  ])("refuses %s as invalid_argument", async (_name, args) => {
    const h = await writeFixture({ handlers: existing() })

    expect((await toolError(h.jobDeploy.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: existing(), credential: RUN_CREDENTIAL })

    expect((await toolError(h.jobDeploy.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test("a value the client masked is refused wherever it is in the job, not sent back with the mask", async () => {
    const masked = `AIza${"a".repeat(35)}`
    for (const job of [
      nightlyJob({ annotations: { key: masked } }),
      nightlyJob({ labels: { key: masked } }),
      nightlyJob({
        template: { template: templateSettings({ containers: [container({ env: [{ name: "K", value: masked }] })] }) },
      }),
    ]) {
      const h = await writeFixture({ handlers: existing(job) })

      const error = await toolError(h.jobDeploy.run())

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("nothing was changed")
      expect(error.message).not.toContain(masked)
      expect(h.writes()).toEqual([])
    }
  })
})

describe("google_run_job_deploy: what Google refuses", () => {
  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The job was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing changed", async (_name, reply) => {
    const h = await writeFixture({ handlers: [jobHandler(), jobPatchHandler(reply)] })

    const error = await toolError(h.jobDeploy.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [jobHandler(), jobPatchHandler(refusal(403, "PERMISSION_DENIED", "No permission."))],
    })
    expect((await toolError(denied.jobDeploy.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [jobHandler(), jobPatchHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.jobDeploy.run())).code).toBe("upstream_error")
  })

  test("a failure to read the job other than a missing one is not taken for a new job", async () => {
    const h = await writeFixture({ handlers: [jobHandler(refusal(403, "PERMISSION_DENIED"))] })

    expect((await toolError(h.jobDeploy.run())).code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })
})
