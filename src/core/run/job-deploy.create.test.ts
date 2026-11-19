import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { JOB_URL, jobCreateHandler, jobHandler } from "./jobs.testing"
import { JOBS_URL } from "./read.testing"
import { OWN_IMAGE, SECRET_VALUE, callOf, cleanUp, freshTokens, refusal, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const missing = () => jobHandler(refusal(404, "NOT_FOUND", "Job not found."))

describe("google_run_job_deploy: a job that does not exist", () => {
  test("is created with a POST to the region's jobs with its id, holding only the image when that is all", async () => {
    const h = await writeFixture({ handlers: [missing(), jobCreateHandler()] })

    const result = await h.jobDeploy.run()

    expect(h.calls().map(callOf)).toEqual([`GET ${JOB_URL}`, `POST ${JOBS_URL}`])
    const [post] = h.writes()
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ jobId: "nightly" })
    expect(post!.json).toEqual({ template: { template: { containers: [{ image: OWN_IMAGE }] } } })
    expect(result).toMatchObject({
      created: true,
      before: null,
      job: { job: "nightly" },
      operation: { operation: "op-1", done: true },
    })
  })

  test("sends only what the call gives, and nothing about the service account, network or secrets", async () => {
    const h = await writeFixture({ handlers: [missing(), jobCreateHandler()] })

    await h.jobDeploy.run({
      container: "worker",
      env: { MODE: "prod", EMPTY: "" },
      command: ["node"],
      args: ["job.js", "--quiet"],
      cpu: "500m",
      memory: "256Mi",
      timeout_seconds: 600,
      task_count: 5,
      parallelism: 2,
      max_retries: 0,
    })

    expect(h.writes()[0]!.json).toEqual({
      template: {
        taskCount: 5,
        parallelism: 2,
        template: {
          containers: [
            {
              name: "worker",
              image: OWN_IMAGE,
              env: [
                { name: "MODE", value: "prod" },
                { name: "EMPTY", value: "" },
              ],
              command: ["node"],
              args: ["job.js", "--quiet"],
              resources: { limits: { cpu: "500m", memory: "256Mi" } },
            },
          ],
          maxRetries: 0,
          timeout: "600s",
        },
      },
    })
  })

  test("a variable to remove is refused: there is nothing to remove, and nothing is sent", async () => {
    const h = await writeFixture({ handlers: [missing(), jobCreateHandler()] })

    const error = await toolError(h.jobDeploy.run({ env: { KEEP: "x", GONE: null } }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`GONE`")
    expect(error.message).toContain("the job does not exist yet")
    expect(h.writes()).toEqual([])
  })

  test("a conflict because someone made the job meanwhile is stale", async () => {
    const h = await writeFixture({
      handlers: [missing(), jobCreateHandler(refusal(409, "ALREADY_EXISTS", "Job already exists."))],
    })

    const error = await toolError(h.jobDeploy.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe("The job changed since it was read; nothing was changed. Read it again and retry.")
  })

  test("returns no environment value from the call", async () => {
    const h = await writeFixture({ handlers: [missing(), jobCreateHandler()] })

    const result = await h.jobDeploy.run({ env: { MODE: SECRET_VALUE } })

    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE)
  })
})
