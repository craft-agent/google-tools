import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { jobHandler, nightlyJob, runHandler } from "./jobs.testing"
import { RUN_CREDENTIAL } from "./read.testing"
import { cleanUp, container, freshTokens, operation, refusal, templateSettings, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The job changed since it was read; nothing was run. Read it again and retry."

const handlers = () => [jobHandler(), runHandler()]

const severalContainers = () =>
  nightlyJob({
    template: { template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }) },
  })

describe("google_run_job_run: refusals before anything is sent", () => {
  test("an override of a variable that references a secret is refused, with the deploy's words", async () => {
    const h = await writeFixture({ handlers: handlers() })

    const error = await toolError(h.jobRun.run({ env: { PLAIN: "ok", TOKEN: "new" } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      "`TOKEN` references a secret, which these tools never set or remove; nothing was changed.",
    )
    expect(h.writes()).toEqual([])
  })

  test("a container that is none of the job's is refused, also when nothing is overridden", async () => {
    const h = await writeFixture({ handlers: handlers() })

    const error = await toolError(h.jobRun.run({ container: "other" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('"other"')
    expect(h.writes()).toEqual([])
  })

  test("a job with several containers needs the one named when env or args are given", async () => {
    const h = await writeFixture({ handlers: [jobHandler({ json: severalContainers() }), runHandler()] })

    for (const args of [{ env: { A: "1" } }, { args: ["x"] }]) {
      const error = await toolError(h.jobRun.run(args))
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain('"app", "sidecar"')
    }
    expect(h.writes()).toEqual([])
  })

  test("a job that does not exist is not_found, and nothing is sent", async () => {
    const h = await writeFixture({ handlers: [jobHandler(refusal(404, "NOT_FOUND")), runHandler()] })

    expect((await toolError(h.jobRun.run())).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("an id that is not a short name is refused before any request", async () => {
    const h = await writeFixture({ handlers: handlers() })

    expect((await toolError(h.jobRun.run({ job: "projects/p/jobs/nightly" }))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a variable removed", { env: { A: null } }],
    ["a variable that is not a name", { env: { "1BAD": "x" } }],
    ["more than 50 variables", { env: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`V${i}`, "x"])) }],
    ["101 arguments", { args: Array.from({ length: 101 }, () => "x") }],
    ["a task count of zero", { task_count: 0 }],
    ["a timeout over seven days", { timeout_seconds: 604_801 }],
    ["an argument only the deploy takes", { task_count: 2, parallelism: 1 }],
  ])("refuses %s as invalid_argument", async (_name, args) => {
    const h = await writeFixture({ handlers: handlers() })

    expect((await toolError(h.jobRun.run(args))).code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: handlers(), credential: RUN_CREDENTIAL })

    expect((await toolError(h.jobRun.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })
})

describe("google_run_job_run: what Google answers", () => {
  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The job was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing run", async (_name, reply) => {
    const h = await writeFixture({ handlers: [jobHandler(), runHandler(reply)] })

    const error = await toolError(h.jobRun.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [jobHandler(), runHandler(refusal(403, "PERMISSION_DENIED", "No permission."))],
    })
    expect((await toolError(denied.jobRun.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [jobHandler(), runHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.jobRun.run())).code).toBe("upstream_error")
  })

  test("a reply that names no operation is an upstream_error, and so is an operation that failed", async () => {
    const nameless = await writeFixture({ handlers: [jobHandler(), runHandler({ json: {} })] })
    const error = await toolError(nameless.jobRun.run())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("named no operation")

    const failed = await writeFixture({
      handlers: [
        jobHandler(),
        runHandler({ json: operation({ done: true, error: { code: 9, message: "Quota exceeded." } }) }),
      ],
    })
    const failure = await toolError(failed.jobRun.run())
    expect(failure.code).toBe("upstream_error")
    expect(failure.message).toContain("Quota exceeded")
  })
})
